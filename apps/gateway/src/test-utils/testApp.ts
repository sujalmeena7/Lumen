import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { InMemoryStores } from '../stores/memory.js';
import { InMemoryRateLimiter } from '../ratelimit/limiter.js';
import { createAdapterRegistry } from '../adapters/registry.js';
import { EnvelopeKeyVault } from '../security/vault.js';
import { generateGatewayKey } from '../security/keys.js';
import { InMemoryTraceStore } from '../observability/tracer.js';
import { InMemoryIdempotencyStore } from '../idempotency/store.js';
import { InMemoryResponseCache } from '../cache/responseCache.js';
import { FakeBillingProvider } from '../billing/fakeProvider.js';
import { InMemorySpendingTracker } from '../spending/tracker.js';
import type { FetchLike } from '../adapters/types.js';

const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_INTERNAL_SERVICE_TOKEN = 'test-internal-service-token';

export function buildTestApp(
  opts: { fetchFn?: FetchLike; rateLimitMax?: number; withInternalServiceToken?: boolean } = {},
) {
  const config = loadConfig({
    NODE_ENV: 'test',
    MASTER_ENCRYPTION_KEY: TEST_MASTER_KEY,
    RATE_LIMIT_MAX: String(opts.rateLimitMax ?? 60),
    RATE_LIMIT_WINDOW_SEC: '60',
    INTERNAL_SERVICE_TOKEN: opts.withInternalServiceToken ? TEST_INTERNAL_SERVICE_TOKEN : undefined,
  } as NodeJS.ProcessEnv);

  const stores = new InMemoryStores();
  const vault = new EnvelopeKeyVault(config.masterEncryptionKey!);
  const rateLimiter = new InMemoryRateLimiter({
    max: config.rateLimitMax,
    windowSec: config.rateLimitWindowSec,
  });
  const noopFetch: FetchLike = async () => {
    throw new Error('fetch not stubbed for this test');
  };
  const adapters = createAdapterRegistry(opts.fetchFn ?? noopFetch);
  const traces = new InMemoryTraceStore();
  const idempotency = new InMemoryIdempotencyStore();
  const cache = new InMemoryResponseCache();
  const billing = new FakeBillingProvider();
  const spendingTracker = new InMemorySpendingTracker();

  const app: FastifyInstance = buildApp({
    config,
    stores,
    rateLimiter,
    adapters,
    vault,
    health: { checkDb: async () => true, checkRedis: async () => true },
    traces,
    idempotency,
    cache,
    billing,
    spendingTracker,
  });

  const { plaintext, hash, prefix } = generateGatewayKey();
  const workspaceId = 'ws_test_1';
  stores.addWorkspace({ id: workspaceId, name: 'Test WS', routingWeights: null });
  stores.addKey(hash, { workspaceId, keyId: 'key_1' });

  // Seed one member per role so tests can exercise RBAC via the X-Member-Id header.
  const ownerId = 'member_owner';
  const adminId = 'member_admin';
  const memberId = 'member_basic';
  stores.addMember(workspaceId, ownerId, 'user_owner', 'owner');
  stores.addMember(workspaceId, adminId, 'user_admin', 'admin');
  stores.addMember(workspaceId, memberId, 'user_member', 'member');

  return {
    app,
    stores,
    vault,
    apiKey: plaintext,
    workspaceId,
    keyPrefix: prefix,
    traces,
    idempotency,
    cache,
    billing,
    spendingTracker,
    ownerId,
    adminId,
    memberId,
  };
}
