import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { openAiError } from '../schemas/chat.js';
import type { ApprovalStore, CredentialStore } from '../stores/types.js';
import type { KeyVault } from '../security/vault.js';
import { ForbiddenError, MembershipRequiredError, requireRole } from '../rbac/roles.js';
import type { EncryptedSecret } from '../security/vault.js';

export interface ApprovalRoutesOptions {
  approvals: ApprovalStore;
  credentials: CredentialStore;
  vault: KeyVault;
}

const ReviewActionSchema = z.object({ action: z.enum(['approve', 'reject']) });

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
 * Human-in-the-loop approval queue (Task 14). Sensitive actions (currently
 * credential rotation/deletion) are queued here when the workspace has
 * `requireApprovalForSensitiveActions` enabled. Approving replays the
 * original action; rejecting discards it. Reviewing requires `admin`+.
 */
export const approvalRoutes: FastifyPluginAsync<ApprovalRoutesOptions> = async (fastify, opts) => {
  fastify.get(
    '/v1/approvals',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      const status = (request.query as { status?: string }).status;
      const parsedStatus =
        status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined;
      const list = await opts.approvals.list(workspace.id, parsedStatus);
      return reply.code(200).send({ approvals: list });
    },
  );

  fastify.post(
    '/v1/approvals/:approvalId/review',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      const { approvalId } = request.params as { approvalId: string };
      const parsed = ReviewActionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(openAiError('Body must be { "action": "approve" | "reject" }.', 'invalid_request_error'));
      }

      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        const approval = await opts.approvals.get(workspace.id, approvalId);
        if (!approval) {
          return reply.code(404).send(openAiError('Approval not found.', 'invalid_request_error'));
        }
        if (approval.status !== 'pending') {
          return reply
            .code(409)
            .send(openAiError(`Approval already ${approval.status}.`, 'invalid_request_error'));
        }

        const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected';
        const updated = await opts.approvals.review(workspace.id, approvalId, newStatus, member.memberId);

        if (newStatus === 'approved' && updated) {
          await applyApprovedAction(opts.credentials, updated);
        }

        return reply.code(200).send({ approval: updated });
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );
};

async function applyApprovedAction(
  credentials: CredentialStore,
  approval: { workspaceId: string; actionType: string; payload: unknown },
): Promise<void> {
  if (approval.actionType === 'credential_rotate') {
    const payload = approval.payload as { provider: string; label: string | null; secret: EncryptedSecret };
    await credentials.upsert(
      approval.workspaceId,
      payload.provider as Parameters<CredentialStore['upsert']>[1],
      payload.secret,
      payload.label,
    );
  } else if (approval.actionType === 'credential_delete') {
    const payload = approval.payload as { provider: string };
    await credentials.remove(
      approval.workspaceId,
      payload.provider as Parameters<CredentialStore['remove']>[1],
    );
  }
}
