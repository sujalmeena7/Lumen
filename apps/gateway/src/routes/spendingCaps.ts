import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { openAiError } from '../schemas/chat.js';
import type { SpendingCapStore, SpendingTracker } from '../spending/tracker.js';
import { monthlySpendKey } from '../spending/tracker.js';
import { ForbiddenError, MembershipRequiredError, requireRole } from '../rbac/roles.js';

export interface SpendingCapRoutesOptions {
  spendingCaps: SpendingCapStore;
  spendingTracker: SpendingTracker;
}

const SetCapSchema = z.object({
  memberId: z.string().min(1).nullable().optional(),
  monthlyLimitUsd: z.number().positive(),
});

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
 * Spending cap management API (Task 16). Setting/removing caps requires
 * `admin`+ role. Workspace-wide caps use `memberId: null`; per-member caps
 * scope to a single `WorkspaceMember.id`.
 */
export const spendingCapRoutes: FastifyPluginAsync<SpendingCapRoutesOptions> = async (fastify, opts) => {
  fastify.post(
    '/v1/spending-caps',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = SetCapSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid request body.', 'invalid_request_error'));
      }
      const workspace = request.workspace!;
      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');
        const cap = await opts.spendingCaps.upsert(
          workspace.id,
          parsed.data.memberId ?? null,
          parsed.data.monthlyLimitUsd,
        );
        return reply.code(201).send({ cap });
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );

  fastify.get(
    '/v1/spending-caps',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      const caps = await opts.spendingCaps.list(workspace.id);
      // Attach the current-month running spend for each configured cap so
      // the dashboard can render "usage vs cap" without a second round-trip.
      const withSpend = await Promise.all(
        caps.map(async (cap) => {
          const key = monthlySpendKey(workspace.id, cap.memberId);
          const currentSpendUsd = await opts.spendingTracker.getSpend(key);
          return { ...cap, currentSpendUsd };
        }),
      );
      return reply.code(200).send({ caps: withSpend });
    },
  );

  fastify.delete(
    '/v1/spending-caps/:memberId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { memberId } = request.params as { memberId: string };
      const workspace = request.workspace!;
      const scopeMemberId = memberId === 'workspace' ? null : memberId;
      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');
        const removed = await opts.spendingCaps.remove(workspace.id, scopeMemberId);
        if (!removed) {
          return reply.code(404).send(openAiError('Spending cap not found.', 'invalid_request_error'));
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
