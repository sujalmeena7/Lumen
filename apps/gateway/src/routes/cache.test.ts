import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';
import type { FetchLike, FetchLikeResponse } from '../adapters/types.js';

function seedOpenAiCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('sk-openai-fake-key');
  t.stores.addCredential(t.workspaceId, 'openai', { provider: 'openai', ...secret });
}

function jsonResponse(body: unknown): FetchLikeResponse {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), body: null };
}

describe('exact-match caching', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('caches an identical repeated request: second call is a $0 cache hit without calling the provider again', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'cached answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const payload = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'What is 2+2?' }] };
    const headers = { authorization: `Bearer ${t.apiKey}` };

    const first = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-cache']).toBe('miss');

    const second = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('hit');
    expect(second.json()).toEqual(first.json());

    expect(calls).toBe(1); // provider called only once
    expect(t.stores.logs).toHaveLength(2);
    expect(t.stores.logs[1]!.cacheHit).toBe(true);
    expect(t.stores.logs[1]!.costUsd).toBe(0);
  });

  it('a changed parameter results in a cache miss', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const headers = { authorization: `Bearer ${t.apiKey}` };
    await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers,
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 },
    });
    const second = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers,
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], temperature: 0.9 },
    });

    expect(second.headers['x-cache']).toBe('miss');
    expect(calls).toBe(2);
  });

  it('does not cache streaming requests', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
        body: (async function* () {
          yield new TextEncoder().encode(
            'data: ' +
              JSON.stringify({
                id: 'c1',
                object: 'chat.completion.chunk',
                created: 1,
                model: 'gpt-4o-mini',
                choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              }) +
              '\n\ndata: [DONE]\n\n',
          );
        })(),
      };
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const payload = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: true };
    const headers = { authorization: `Bearer ${t.apiKey}` };
    await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    expect(calls).toBe(2); // no caching applied to streaming requests
  });

  it('respects a per-workspace cache opt-out', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);
    t.stores.addWorkspace({ id: t.workspaceId, name: 'Test WS', routingWeights: null, cacheDisabled: true });

    const payload = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };
    const headers = { authorization: `Bearer ${t.apiKey}` };
    const first = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    const second = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    expect(first.headers['x-cache']).toBe('miss');
    expect(second.headers['x-cache']).toBe('miss');
    expect(calls).toBe(2);
  });
});
