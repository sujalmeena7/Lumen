import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { NormalizedChatRequest, NormalizedChatResponse } from '@router/core';

/**
 * Exact-match response cache (Task 12).
 *
 * Caches the full normalized response for a given (workspace, resolved model,
 * request parameters) tuple. A cache hit costs $0 and returns in milliseconds.
 * Deliberately conservative about *what* gets cached/served from cache:
 *
 *  - Only non-streaming requests (streaming is inherently "live" and a cached
 *    stream isn't meaningfully faster to the client).
 *  - Only requests without `tools`/`tool_choice` (tool-calling responses can
 *    depend on external state; caching them risks staleness/incorrectness).
 *  - Keyed by the RESOLVED model (not "auto"), so a cache entry always reflects
 *    a specific, deterministic model+params combination.
 *  - Always scoped by workspaceId so entries never leak across tenants.
 */
export interface CacheKeyInput {
  workspaceId: string;
  resolvedModel: string;
  request: NormalizedChatRequest;
}

/** Whether a request is even eligible to be cached / served from cache. */
export function isCacheable(request: NormalizedChatRequest): boolean {
  if (request.stream) return false;
  if (request.tools && request.tools.length > 0) return false;
  if (request.tool_choice !== undefined) return false;
  return true;
}

/** Builds a deterministic hash key for a cacheable request. */
export function buildCacheKey(input: CacheKeyInput): string {
  const { workspaceId, resolvedModel, request } = input;
  const normalized = {
    model: resolvedModel,
    messages: request.messages,
    temperature: request.temperature ?? null,
    top_p: request.top_p ?? null,
    max_tokens: request.max_tokens ?? null,
    stop: request.stop ?? null,
  };
  const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return `cache:${workspaceId}:${hash}`;
}

export interface ResponseCache {
  get(key: string): Promise<NormalizedChatResponse | null>;
  set(key: string, response: NormalizedChatResponse, ttlSec: number): Promise<void>;
}

const DEFAULT_TTL_SEC = 60 * 60; // 1 hour

export class RedisResponseCache implements ResponseCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = DEFAULT_TTL_SEC,
  ) {}

  async get(key: string): Promise<NormalizedChatResponse | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as NormalizedChatResponse;
    } catch {
      return null;
    }
  }

  async set(key: string, response: NormalizedChatResponse, ttlSec = this.ttlSec): Promise<void> {
    await this.redis.set(key, JSON.stringify(response), 'EX', ttlSec);
  }
}

export class InMemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, { value: NormalizedChatResponse; expiresAt: number }>();

  async get(key: string): Promise<NormalizedChatResponse | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, response: NormalizedChatResponse, ttlSec = DEFAULT_TTL_SEC): Promise<void> {
    this.entries.set(key, { value: response, expiresAt: Date.now() + ttlSec * 1000 });
  }
}
