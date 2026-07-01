import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Redis } from 'ioredis';
import { getPrisma } from '@router/db';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createAdapterRegistry } from './adapters/registry.js';
import { createPrismaStores } from './stores/prisma.js';
import { RedisRateLimiter } from './ratelimit/limiter.js';
import { EnvelopeKeyVault } from './security/vault.js';
import { InMemoryTraceStore } from './observability/tracer.js';
import { RedisIdempotencyStore } from './idempotency/store.js';
import { RedisResponseCache } from './cache/responseCache.js';
import { RazorpayBillingProvider } from './billing/razorpayProvider.js';
import type { BillingProvider } from './billing/types.js';
import { RedisSpendingTracker } from './spending/tracker.js';

// Load the monorepo-root `.env` into process.env before reading any config.
// Uses Node's built-in env parser (stable since v20.12) rather than a
// dotenv dependency. Outside production, explicitly overwrites any
// pre-existing process.env value for a key defined in the file — some
// hosting/sandbox environments pre-seed empty-string placeholders for
// expected variable names, which would otherwise shadow the real value
// from `.env`. In production, real platform-injected env vars always win
// and `.env` is only used to fill in anything not already set.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dirname, '../../../.env');
  const parsed = parseEnv(readFileSync(envPath, 'utf8'));
  const isProduction = process.env.NODE_ENV === 'production';
  for (const [key, value] of Object.entries(parsed)) {
    if (isProduction && process.env[key]) continue;
    process.env[key] = value;
  }
} catch {
  // No .env file present, or running on a Node version without
  // util.parseEnv — fall back to whatever is already in process.env.
}

async function main() {
  const config = loadConfig();

  if (!config.masterEncryptionKey) {
    throw new Error('MASTER_ENCRYPTION_KEY is required to start the gateway.');
  }
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required to start the gateway.');
  }

  const prisma = getPrisma();
  const redis = new Redis(config.redisUrl);
  const vault = new EnvelopeKeyVault(config.masterEncryptionKey);
  const stores = createPrismaStores(prisma);
  const rateLimiter = new RedisRateLimiter(redis, {
    max: config.rateLimitMax,
    windowSec: config.rateLimitWindowSec,
  });
  const adapters = createAdapterRegistry(fetch as unknown as import('./adapters/types.js').FetchLike);
  const billing: BillingProvider = new RazorpayBillingProvider(
    config.razorpayKeyId ?? '',
    config.razorpayKeySecret ?? '',
    config.razorpayWebhookSecret ?? '',
  );

  const app = buildApp({
    config,
    stores,
    rateLimiter,
    adapters,
    vault,
    health: {
      checkDb: async () => {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      },
      checkRedis: async () => (await redis.ping()) === 'PONG',
    },
    // Traces are an ephemeral, in-process debugging aid (bounded ring buffer).
    // Durable request history for the dashboard lives in Postgres RequestLog.
    traces: new InMemoryTraceStore(),
    idempotency: new RedisIdempotencyStore(redis),
    cache: new RedisResponseCache(redis),
    billing,
    spendingTracker: new RedisSpendingTracker(redis),
  });

  await app.listen({ port: config.port, host: config.host });

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error starting gateway:', err);
  process.exit(1);
});
