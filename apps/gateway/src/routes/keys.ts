import type { FastifyPluginAsync } from 'fastify';
import { CreateGatewayKeyRequestSchema } from '../schemas/keys.js';
import { openAiError } from '../schemas/chat.js';
import type { KeyStore } from '../stores/types.js';
import { generateGatewayKey } from '../security/keys.js';
import { ForbiddenError, MembershipRequiredError, requireRole } from '../rbac/roles.js';

export interface KeyRoutesOptions {
  keys: KeyStore;
}

function requireMember(request: import('fastify').FastifyRequest) {
  if (!request.member) {
    throw new MembershipRequiredError(
      'This action requires an X-Member-Id header identifying the acting workspace member.',
    );
  }
  return request.member;
}

function handleRbacError(err: unknown, reply: import('fastify').FastifyReply) {
  if (err instanceof ForbiddenError) {
    return reply.code(403).send(openAiError(err.message, 'permission_error'));
  }
  if (err instanceof MembershipRequiredError) {
    return reply.code(401).send(openAiError(err.message, 'invalid_request_error'));
  }
  return null;
}

/**
 * Gateway API key management (Task 17, extends the seed-only key creation
 * from earlier tasks). These are the credentials OUR customers use to call
 * `/v1/chat/completions`. The plaintext is only ever returned once, at
 * creation time; everything else (list) is metadata-only.
 *
 * Creating/revoking a key is scoped to the authenticated caller's workspace
 * and requires the acting member to have the `admin` role or higher.
 */
export const keyRoutes: FastifyPluginAsync<KeyRoutesOptions> = async (fastify, opts) => {
  fastify.post(
    '/v1/keys',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = CreateGatewayKeyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid request body.', 'invalid_request_error'));
      }
      const workspace = request.workspace!;

      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        const generated = generateGatewayKey();
        const summary = await opts.keys.create({
          workspaceId: workspace.id,
          name: parsed.data.name,
          keyHash: generated.hash,
          keyPrefix: generated.prefix,
        });

        return reply.code(201).send({
          id: summary.id,
          name: summary.name,
          keyPrefix: summary.keyPrefix,
          createdAt: summary.createdAt,
          // Shown ONCE. Never persisted or returned again.
          plaintext: generated.plaintext,
        });
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );

  fastify.get(
    '/v1/keys',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      const list = await opts.keys.list(workspace.id);
      return reply.code(200).send({
        keys: list.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          revokedAt: k.revokedAt,
        })),
      });
    },
  );

  fastify.delete(
    '/v1/keys/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const workspace = request.workspace!;

      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        const revoked = await opts.keys.revoke(workspace.id, id);
        if (!revoked) {
          return reply.code(404).send(openAiError('Gateway key not found.', 'invalid_request_error'));
        }
        return reply.code(204).send();
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );
};
