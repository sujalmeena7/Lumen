import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Stores } from './stores/types.js';
import type { RateLimiter } from './ratelimit/limiter.js';
import type { AdapterRegistry } from './adapters/registry.js';
import type { KeyVault } from './security/vault.js';
import type { TraceStore } from './observability/tracer.js';
import type { IdempotencyStore } from './idempotency/store.js';
import type { ResponseCache } from './cache/responseCache.js';
import { CredentialResolver } from './security/credentials.js';
import { ChatService } from './services/chatService.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes, type HealthCheckers } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { traceRoutes } from './routes/traces.js';
import { credentialRoutes } from './routes/credentials.js';
import { approvalRoutes } from './routes/approvals.js';
import { billingRoutes } from './routes/billing.js';
import { authRoutes } from './routes/auth.js';
import { keyRoutes } from './routes/keys.js';
import { analyticsRoutes } from './routes/analytics.js';
import { workspaceRoutes } from './routes/workspaces.js';
import type { BillingProvider } from './billing/types.js';
import { SpendingCapEnforcer } from './spending/enforcer.js';
import type { SpendingTracker } from './spending/tracker.js';
import { spendingCapRoutes } from './routes/spendingCaps.js';

export interface BuildAppDeps {
  config: Config;
  stores: Stores;
  rateLimiter: RateLimiter;
  adapters: AdapterRegistry;
  vault: KeyVault;
  health: HealthCheckers;
  traces: TraceStore;
  idempotency: IdempotencyStore;
  cache: ResponseCache;
  billing: BillingProvider;
  spendingTracker: SpendingTracker;
}

/**
 * Assembles the Fastify app from injected dependencies. Production wiring
 * (Prisma stores, Redis limiter, real fetch, envelope vault) lives in
 * `server.ts`; tests inject in-memory/mocked equivalents here directly.
 */
export function buildApp(deps: BuildAppDeps): FastifyInstance {
  const fastify = Fastify({ logger: deps.config.nodeEnv !== 'test' });

  const credentials = new CredentialResolver(deps.stores.credentials, deps.vault);
  const spendingCapEnforcer = new SpendingCapEnforcer(deps.stores.spendingCaps, deps.spendingTracker);
  const chatService = new ChatService({
    adapters: deps.adapters,
    credentials,
    requestLogs: deps.stores.requestLogs,
    config: deps.config,
    traces: deps.traces,
    cache: deps.cache,
    spendingCaps: spendingCapEnforcer,
  });

  fastify.register(authPlugin, {
    stores: deps.stores,
    rateLimiter: deps.rateLimiter,
    internalServiceToken: deps.config.internalServiceToken,
  });
  fastify.register(healthRoutes, deps.health);
  fastify.register(chatRoutes, { chatService, idempotency: deps.idempotency });
  fastify.register(traceRoutes, { traces: deps.traces });
  fastify.register(credentialRoutes, {
    credentials: deps.stores.credentials,
    vault: deps.vault,
    approvals: deps.stores.approvals,
  });
  fastify.register(approvalRoutes, {
    approvals: deps.stores.approvals,
    credentials: deps.stores.credentials,
    vault: deps.vault,
  });
  fastify.register(billingRoutes, {
    billing: deps.billing,
    workspaces: deps.stores.workspaces,
    webhookEvents: deps.stores.webhookEvents,
  });
  fastify.register(spendingCapRoutes, {
    spendingCaps: deps.stores.spendingCaps,
    spendingTracker: deps.spendingTracker,
  });
  fastify.register(authRoutes, { users: deps.stores.users });
  fastify.register(keyRoutes, { keys: deps.stores.keys });
  fastify.register(analyticsRoutes, { requestLogs: deps.stores.requestLogs });
  fastify.register(workspaceRoutes, { memberships: deps.stores.memberships });

  return fastify;
}
