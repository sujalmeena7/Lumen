import type { FastifyPluginAsync } from 'fastify';
import { DevLoginRequestSchema } from '../schemas/auth.js';
import { openAiError } from '../schemas/chat.js';
import type { UserStore } from '../stores/types.js';

export interface AuthRoutesOptions {
  users: UserStore;
}

/**
 * Minimal dev-grade identity for the dashboard (Task 17).
 *
 * This is intentionally NOT a production identity provider: there is no
 * password, OAuth flow, or MFA. It finds-or-creates a `User` by email and
 * returns their workspace memberships so the Next.js dashboard (a thin BFF)
 * can establish a session. All real authorization (role checks, sensitive
 * action approvals) continues to happen in the gateway via gateway-key auth
 * + `X-Member-Id`, exactly as it does for every other route — this endpoint
 * only resolves "who is this person and which workspaces can they act in."
 */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, opts) => {
  fastify.post('/v1/auth/dev-login', async (request, reply) => {
    const parsed = DevLoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid request body.', 'invalid_request_error'));
    }

    const user = await opts.users.findOrCreateByEmail(parsed.data.email);
    const memberships = await opts.users.listMemberships(user.id);

    return reply.code(200).send({
      user: { id: user.id, email: user.email, name: user.name },
      memberships: memberships.map((m) => ({
        memberId: m.memberId,
        role: m.role,
        workspace: m.workspace,
      })),
    });
  });
};
