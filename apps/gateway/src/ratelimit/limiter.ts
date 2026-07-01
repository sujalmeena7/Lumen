import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSec: number;
}

/** Fixed-window rate limiter abstraction. */
export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export interface RateLimitOptions {
  max: number;
  windowSec: number;
}

/** Redis-backed fixed-window limiter (INCR + EXPIRE). */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly opts: RateLimitOptions,
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / this.opts.windowSec);
    const redisKey = `ratelimit:${key}:${window}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, this.opts.windowSec);
    }
    const resetSec = (window + 1) * this.opts.windowSec - now;
    return {
      allowed: count <= this.opts.max,
      remaining: Math.max(0, this.opts.max - count),
      limit: this.opts.max,
      resetSec,
    };
  }
}

/** In-memory fixed-window limiter for tests/local use. */
export class InMemoryRateLimiter implements RateLimiter {
  private counts = new Map<string, { count: number; window: number }>();

  constructor(private readonly opts: RateLimitOptions) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / this.opts.windowSec);
    const entry = this.counts.get(key);
    let count: number;
    if (!entry || entry.window !== window) {
      count = 1;
      this.counts.set(key, { count, window });
    } else {
      count = ++entry.count;
    }
    const resetSec = (window + 1) * this.opts.windowSec - now;
    return {
      allowed: count <= this.opts.max,
      remaining: Math.max(0, this.opts.max - count),
      limit: this.opts.max,
      resetSec,
    };
  }
}
