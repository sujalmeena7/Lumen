import type { FastifyPluginAsync } from 'fastify';
import { CreateCredentialRequestSchema } from '../schemas/credentials.js';
import { openAiError } from '../schemas/chat.js';
import type { ApprovalStore, CredentialStore } from '../stores/types.js';
import type { KeyVault } from '../security/vault.js';
import { ForbiddenError, MembershipRequiredError, requireRole } from '../rbac/roles.js';

export interface CredentialRoutesOptions {
  credentials: CredentialStore;
  vault: KeyVault;
  approvals: ApprovalStore;
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
 * Server-side credential management API (Task 13, extended with RBAC in
 * Task 14).
 *
 * Security invariants:
 *  - The plaintext provider API key is accepted once over the request body
 *    (TLS in production), immediately encrypted via the KMS-ready `KeyVault`,
 *    and never persisted or logged in plaintext.
 *  - `GET` returns only metadata (provider, label, timestamps) — the
 *    ciphertext and decrypted key are NEVER returned to any client.
 *  - All operations are scoped to the authenticated caller's workspace.
 *  - Rotating/deleting a credential is a sensitive action: it requires the
 *    acting member to have the `admin` role (or higher), and if the
 *    workspace has `requireApprovalForSensitiveActions` enabled, the action
 *    is queued as a `PendingApproval` instead of applied immediately.
 */
export const credentialRoutes: FastifyPluginAsync<CredentialRoutesOptions> = async (fastify, opts) => {
  // Create or rotate a provider credential.
  fastify.post(
    '/v1/credentials',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = CreateCredentialRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid request body.', 'invalid_request_error'));
      }
      const { provider, apiKey, label } = parsed.data;
      const workspace = request.workspace!;

      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        if (workspace.requireApprovalForSensitiveActions) {
          // Do NOT persist the plaintext key in the approval payload long-term
          // in a real system this would go through a short-lived secure queue;
          // here we still encrypt it immediately so nothing plaintext is ever
          // written to a store, then hold the encrypted secret for approval.
          const secret = opts.vault.encrypt(apiKey);
          const approval = await opts.approvals.create({
            workspaceId: workspace.id,
            actionType: 'credential_rotate',
            requestedById: member.memberId,
            payload: { provider, label: label ?? null, secret },
          });
          return reply.code(202).send({ status: 'pending_approval', approvalId: approval.id });
        }

        const secret = opts.vault.encrypt(apiKey);
        await opts.credentials.upsert(workspace.id, provider, secret, label ?? null);
        return reply.code(201).send({ provider, label: label ?? null, status: 'stored' });
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );

  // List credential metadata (never secrets) for the workspace.
  fastify.get(
    '/v1/credentials',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      const list = await opts.credentials.list(workspace.id);
      return reply.code(200).send({
        credentials: list.map((c) => ({
          provider: c.provider,
          label: c.label,
          createdAt: c.createdAt,
          rotatedAt: c.rotatedAt,
        })),
      });
    },
  );

  // Delete a provider credential.
  fastify.delete(
    '/v1/credentials/:provider',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { provider } = request.params as { provider: string };
      const parsedProvider = CreateCredentialRequestSchema.shape.provider.safeParse(provider);
      if (!parsedProvider.success) {
        return reply
          .code(400)
          .send(openAiError(`Unknown provider: ${provider}`, 'invalid_request_error'));
      }
      const workspace = request.workspace!;

      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        if (workspace.requireApprovalForSensitiveActions) {
          const approval = await opts.approvals.create({
            workspaceId: workspace.id,
            actionType: 'credential_delete',
            requestedById: member.memberId,
            payload: { provider: parsedProvider.data },
          });
          return reply.code(202).send({ status: 'pending_approval', approvalId: approval.id });
        }

        const removed = await opts.credentials.remove(workspace.id, parsedProvider.data);
        if (!removed) {
          return reply.code(404).send(openAiError('Credential not found.', 'invalid_request_error'));
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
