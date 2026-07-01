import { describe, it, expect } from 'vitest';
import { buildCacheKey, isCacheable, InMemoryResponseCache } from './responseCache.js';
import type { NormalizedChatRequest, NormalizedChatResponse } from '@router/core';

const baseReq: NormalizedChatRequest = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('isCacheable', () => {
  it('is cacheable for a plain non-streaming request', () => {
    expect(isCacheable(baseReq)).toBe(true);
  });
  it('is not cacheable when streaming', () => {
    expect(isCacheable({ ...baseReq, stream: true })).toBe(false);
  });
  it('is not cacheable when tools are present', () => {
    expect(isCacheable({ ...baseReq, tools: [{ type: 'function' }] })).toBe(false);
  });
  it('is not cacheable when tool_choice is set', () => {
    expect(isCacheable({ ...baseReq, tool_choice: 'auto' })).toBe(false);
  });
});

describe('buildCacheKey', () => {
  it('is deterministic for identical inputs', () => {
    const a = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'gpt-4o-mini', request: baseReq });
    const b = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'gpt-4o-mini', request: baseReq });
    expect(a).toBe(b);
  });

  it('differs across workspaces (never leaks cross-tenant)', () => {
    const a = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'gpt-4o-mini', request: baseReq });
    const b = buildCacheKey({ workspaceId: 'ws2', resolvedModel: 'gpt-4o-mini', request: baseReq });
    expect(a).not.toBe(b);
  });

  it('differs when the resolved model differs', () => {
    const a = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'gpt-4o-mini', request: baseReq });
    const b = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'claude-3-5-haiku', request: baseReq });
    expect(a).not.toBe(b);
  });

  it('differs when a parameter (e.g. temperature) differs', () => {
    const a = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'gpt-4o-mini', request: baseReq });
    const b = buildCacheKey({
      workspaceId: 'ws1',
      resolvedModel: 'gpt-4o-mini',
      request: { ...baseReq, temperature: 0.9 },
    });
    expect(a).not.toBe(b);
  });

  it('differs when the message content differs', () => {
    const a = buildCacheKey({ workspaceId: 'ws1', resolvedModel: 'gpt-4o-mini', request: baseReq });
    const b = buildCacheKey({
      workspaceId: 'ws1',
      resolvedModel: 'gpt-4o-mini',
      request: { ...baseReq, messages: [{ role: 'user', content: 'bye' }] },
    });
    expect(a).not.toBe(b);
  });
});

describe('InMemoryResponseCache', () => {
  const sampleResponse: NormalizedChatResponse = {
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [{ index: 0, message: { role: 'assistant', content: 'cached!' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  it('returns null on miss', async () => {
    const cache = new InMemoryResponseCache();
    expect(await cache.get('missing')).toBeNull();
  });

  it('returns the stored response on hit', async () => {
    const cache = new InMemoryResponseCache();
    await cache.set('k1', sampleResponse, 60);
    expect(await cache.get('k1')).toEqual(sampleResponse);
  });

  it('expires entries after the TTL', async () => {
    const cache = new InMemoryResponseCache();
    await cache.set('k1', sampleResponse, -1); // already expired
    expect(await cache.get('k1')).toBeNull();
  });
});
