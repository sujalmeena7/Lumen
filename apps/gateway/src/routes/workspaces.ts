import type { FastifyPluginAsync } from 'fastify';
import type { MembershipStore } from '../stores/types.js';

export interface WorkspaceRoutesOptions {
  memberships: MembershipStore;
}

/**
 * Workspace-scoped read endpoints (Task 19). Currently just member listing,
 * used by the dashboard to let an admin pick a member when setting a
 * per-member spending cap. Read-only, no member identity required — same
 * trust level as viewing traces or analytics.
 */
export const workspaceRoutes: FastifyPluginAsync<WorkspaceRoutesOptions> = async (fastify, opts) => {
  fastify.get(
    '/v1/workspaces/members',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      const members = await opts.memberships.listForWorkspace(workspace.id);
      return reply.code(200).send({
        members: members.map((m) => ({ memberId: m.memberId, email: m.email, role: m.role })),
      });
    },
  );
};
