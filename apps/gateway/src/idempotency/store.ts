import type { Redis } from 'ioredis';

/**
 * Deduplicates retried client requests bearing the same `Idempotency-Key`.
 * On a cache hit, the gateway returns the previously computed result instead
 * of re-calling the upstream provider (avoiding double-billing and duplicate
 * side effects on the client's retry).
 */
export interface IdempotencyStore {
  /** Returns the cached result for a key, or null if not present/expired. */
  get(key: string): Promise<string | null>;
  /** Stores the result for a key with a TTL (seconds). */
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

const DEFAULT_TTL_SEC = 24 * 60 * 60;

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = DEFAULT_TTL_SEC,
  ) {}

  private redisKey(key: string): string {
    return `idempotency:${key}`;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(this.redisKey(key));
  }

  async set(key: string, value: string, ttlSec = this.ttlSec): Promise<void> {
    await this.redis.set(this.redisKey(key), value, 'EX', ttlSec);
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec = DEFAULT_TTL_SEC): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
}

/** Scopes an idempotency key to a workspace so keys never collide cross-tenant. */
export function scopedIdempotencyKey(workspaceId: string, idempotencyKey: string): string {
  return `${workspaceId}:${idempotencyKey}`;
}
