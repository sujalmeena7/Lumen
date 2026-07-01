import type { FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import { extractBearer, hashGatewayKey } from '../security/keys.js';
import type { RateLimiter } from '../ratelimit/limiter.js';
import type { MemberInfo, Stores, WorkspaceInfo } from '../stores/types.js';
import { openAiError } from '../schemas/chat.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace?: WorkspaceInfo;
    /**
     * The workspace member acting on this request, resolved from the
     * `X-Member-Id` header when present (Task 14 RBAC). Gateway keys are
     * workspace-wide service credentials, so a request can be authenticated
     * without an acting member (e.g. `/v1/chat/completions` from a CI job);
     * member identity is only required for role-gated management actions.
     */
    member?: MemberInfo;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthPluginOptions {
  stores: Stores;
  rateLimiter: RateLimiter;
  /** See `Config.internalServiceToken`. */
  internalServiceToken?: string;
}

/** Constant-time string comparison (avoids leaking length/prefix via timing). */
function safeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Authenticates the gateway API key (Bearer token) against the hashed key
 * store, resolves the workspace, and enforces a per-key rate limit. Runs as a
 * preHandler on protected routes. Mandatory before any provider call since
 * this service is network-exposed.
 *
 * Also accepts trusted first-party service-to-service auth: if
 * `internalServiceToken` is configured and the bearer token matches it
 * exactly, the caller authenticates as the workspace named by the
 * `X-Workspace-Id` header instead of resolving a gateway key. This exists
 * solely for the Next.js dashboard BFF (server-side only, never exposed to
 * browsers) so gateway-key hashing doesn't block first-party server code
 * from managing keys/credentials on a logged-in user's behalf. Rate limiting
 * is intentionally skipped for this path (trusted internal caller, not a
 * customer-facing key) but RBAC via `X-Member-Id` still applies identically.
 *
 * Wrapped with `fastify-plugin` so the `authenticate` decorator is visible on
 * the root instance (and therefore to sibling route plugins), bypassing
 * Fastify's default plugin encapsulation.
 */
export const authPlugin = fp<AuthPluginOptions>(
  async (fastify, opts) => {
    fastify.decorate(
      'authenticate',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const token = extractBearer(request.headers.authorization);
        if (!token) {
          reply.code(401).send(openAiError('Missing API key.', 'invalid_request_error'));
          return;
        }

        if (opts.internalServiceToken && safeStringEqual(token, opts.internalServiceToken)) {
          const workspaceIdHeader = request.headers['x-workspace-id'];
          if (typeof workspaceIdHeader !== 'string' || workspaceIdHeader.length === 0) {
            reply
              .code(401)
              .send(openAiError('X-Workspace-Id header is required for service auth.', 'invalid_request_error'));
            return;
          }
          const workspace = await opts.stores.workspaces.get(workspaceIdHeader);
          if (!workspace) {
            reply.code(401).send(openAiError('Workspace not found.', 'invalid_request_error'));
            return;
          }
          request.workspace = workspace;
          await resolveMember(request, reply, opts.stores, workspace);
          return;
        }

        const keyHash = hashGatewayKey(token);
        const resolved = await opts.stores.keys.findByHash(keyHash);
        if (!resolved) {
          reply.code(401).send(openAiError('Invalid API key.', 'invalid_request_error'));
          return;
        }

        const rl = await opts.rateLimiter.check(resolved.keyId);
        reply.header('x-ratelimit-limit', rl.limit);
        reply.header('x-ratelimit-remaining', rl.remaining);
        if (!rl.allowed) {
          reply.header('retry-after', rl.resetSec);
          reply.code(429).send(openAiError('Rate limit exceeded.', 'rate_limit_error'));
          return;
        }

        const workspace = await opts.stores.workspaces.get(resolved.workspaceId);
        if (!workspace) {
          reply
            .code(401)
            .send(openAiError('Workspace not found for API key.', 'invalid_request_error'));
          return;
        }

        request.workspace = workspace;
        void opts.stores.keys.touchLastUsed(resolved.keyId);

        await resolveMember(request, reply, opts.stores, workspace);
      },
    );
  },
  { name: 'auth-plugin' },
);

async function resolveMember(
  request: FastifyRequest,
  reply: FastifyReply,
  stores: Stores,
  workspace: WorkspaceInfo,
): Promise<void> {
  const memberIdHeader = request.headers['x-member-id'];
  if (typeof memberIdHeader === 'string' && memberIdHeader.length > 0) {
    const member: MemberInfo | null = await stores.memberships.get(workspace.id, memberIdHeader);
    if (!member) {
      reply.code(401).send(openAiError('Unknown member for this workspace.', 'invalid_request_error'));
      return;
    }
    request.member = member;
  }
}
