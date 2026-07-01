import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';
import type { FetchLike, FetchLikeResponse } from '../adapters/types.js';

function seedOpenAiCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('sk-openai-fake-key');
  t.stores.addCredential(t.workspaceId, 'openai', { provider: 'openai', ...secret });
}
function seedAnthropicCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('sk-ant-fake-key');
  t.stores.addCredential(t.workspaceId, 'anthropic', { provider: 'anthropic', ...secret });
}

function jsonResponse(body: unknown, status = 200): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  };
}

describe('resiliency: fallback', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('falls back to another model and reports x-router-fallback when the primary errors', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async (url) => {
      calls++;
      if (url.includes('openai.com')) {
        // Primary (gpt-4o-mini) always fails, even across retries.
        return jsonResponse({}, 500);
      }
      // Fallback candidate (anthropic) succeeds.
      return jsonResponse({
        id: 'msg_ok',
        content: [{ type: 'text', text: 'fallback answer' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    };

    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);
    seedAnthropicCredential(t);

    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-router-fallback']).toBe('true');
    expect(res.headers['x-router-model']).not.toBe('gpt-4o-mini');
    expect(res.json().choices[0].message.content).toBe('fallback answer');
    expect(t.stores.logs[0]!.fallbackUsed).toBe(true);
    expect(calls).toBeGreaterThan(1);
  });

  it('does not set x-router-fallback when the primary succeeds', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        id: 'chatcmpl-x',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-router-fallback']).toBeUndefined();
  });
});

describe('resiliency: idempotency', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('replays the cached response for a repeated Idempotency-Key without re-calling the provider', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse({
        id: 'chatcmpl-once',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'first result' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      });
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const payload = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };
    const headers = { authorization: `Bearer ${t.apiKey}`, 'idempotency-key': 'client-retry-key-1' };

    const first = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    const second = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(calls).toBe(1); // provider was only called once despite two client requests
  });

  it('treats different idempotency keys as independent requests', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    // Distinct message content per request so exact-match caching (Task 12)
    // doesn't also dedupe these calls - isolates idempotency-key behavior.
    await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}`, 'idempotency-key': 'key-a' },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'request A' }] },
    });
    await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}`, 'idempotency-key': 'key-b' },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'request B' }] },
    });
    expect(calls).toBe(2);
  });
});
