import type { Redis } from 'ioredis';

export interface SpendingCapRecord {
  id: string;
  workspaceId: string;
  /** null = workspace-wide cap; otherwise scoped to one member. */
  memberId: string | null;
  monthlyLimitUsd: number;
}

/** CRUD for configured spending caps (Task 16). */
export interface SpendingCapStore {
  /** Returns the workspace-wide cap (memberId = null), if any. */
  getWorkspaceCap(workspaceId: string): Promise<SpendingCapRecord | null>;
  /** Returns the per-member cap for a specific member, if any. */
  getMemberCap(workspaceId: string, memberId: string): Promise<SpendingCapRecord | null>;
  /** Creates or replaces a cap (workspace-wide when memberId is null). */
  upsert(workspaceId: string, memberId: string | null, monthlyLimitUsd: number): Promise<SpendingCapRecord>;
  list(workspaceId: string): Promise<SpendingCapRecord[]>;
  remove(workspaceId: string, memberId: string | null): Promise<boolean>;
}

/**
 * Tracks running spend per (workspace[, member]) for the current calendar
 * month, for FAST pre-flight cap checks. Backed by Redis in production
 * (INCRBYFLOAT with a TTL through month-end) and reconciled against the
 * authoritative Postgres `RequestLog` sum periodically / on cache miss.
 */
export interface SpendingTracker {
  /** Current running spend for the given scope in the current month. */
  getSpend(scopeKey: string): Promise<number>;
  /** Atomically adds `amountUsd` to the running spend and returns the new total. */
  addSpend(scopeKey: string, amountUsd: number): Promise<number>;
  /** Seeds/corrects the running total (used for reconciliation with Postgres). */
  setSpend(scopeKey: string, amountUsd: number): Promise<void>;
}

/** Deterministic month-scoped key, e.g. "spend:ws1:2025-01" or "spend:ws1:member1:2025-01". */
export function monthlySpendKey(workspaceId: string, memberId: string | null, now = new Date()): string {
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return memberId ? `spend:${workspaceId}:${memberId}:${bucket}` : `spend:${workspaceId}:${bucket}`;
}

/** Seconds remaining until the end of the current UTC month (for Redis TTL). */
function secondsUntilMonthEnd(now = new Date()): number {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(1, Math.floor((nextMonth.getTime() - now.getTime()) / 1000));
}

export class RedisSpendingTracker implements SpendingTracker {
  constructor(private readonly redis: Redis) {}

  async getSpend(scopeKey: string): Promise<number> {
    const value = await this.redis.get(scopeKey);
    return value ? Number(value) : 0;
  }

  async addSpend(scopeKey: string, amountUsd: number): Promise<number> {
    const total = await this.redis.incrbyfloat(scopeKey, amountUsd);
    // Ensure the key expires at month-end so we don't accumulate forever.
    await this.redis.expire(scopeKey, secondsUntilMonthEnd());
    return Number(total);
  }

  async setSpend(scopeKey: string, amountUsd: number): Promise<void> {
    await this.redis.set(scopeKey, amountUsd, 'EX', secondsUntilMonthEnd());
  }
}

export class InMemorySpendingTracker implements SpendingTracker {
  private readonly totals = new Map<string, number>();

  async getSpend(scopeKey: string): Promise<number> {
    return this.totals.get(scopeKey) ?? 0;
  }

  async addSpend(scopeKey: string, amountUsd: number): Promise<number> {
    const next = (this.totals.get(scopeKey) ?? 0) + amountUsd;
    this.totals.set(scopeKey, next);
    return next;
  }

  async setSpend(scopeKey: string, amountUsd: number): Promise<void> {
    this.totals.set(scopeKey, amountUsd);
  }
}
