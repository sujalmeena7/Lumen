import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';
import { createMockFetch } from '../test-utils/mockFetch.js';

function seedOpenAiCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('sk-openai-fake-key');
  t.stores.addCredential(t.workspaceId, 'openai', { provider: 'openai', ...secret });
}
function seedAnthropicCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('sk-ant-fake-key');
  t.stores.addCredential(t.workspaceId, 'anthropic', { provider: 'anthropic', ...secret });
}
function seedGroqCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('gsk-fake-key');
  t.stores.addCredential(t.workspaceId, 'groq', { provider: 'groq', ...secret });
}

describe('GET /v1/traces/:traceId', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 404 for an unknown trace id', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/traces/does-not-exist',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('records a full successful lifecycle queryable by trace id', async () => {
    const { fetchFn } = createMockFetch([
      {
        json: {
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        },
      },
    ]);
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const chatRes = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    const traceId = chatRes.headers['x-trace-id'] as string;
    expect(traceId).toBeDefined();

    const traceRes = await t.app.inject({
      method: 'GET',
      url: `/v1/traces/${traceId}`,
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(traceRes.statusCode).toBe(200);
    const trace = traceRes.json();
    const spanNames = trace.spans.map((s: { name: string }) => s.name);
    expect(spanNames).toEqual(['route', 'cache', 'provider_call', 'response']);
    expect(trace.spans.every((s: { status: string }) => s.status === 'ok')).toBe(true);
  });

  it('records which model failed when the provider call errors (after exhausting retries/fallbacks)', async () => {
    // Every upstream call fails, so retries against the primary AND all
    // fallback models are exhausted, and the final error propagates.
    const fetchFn: import('../adapters/types.js').FetchLike = async () => ({
      ok: false,
      status: 500,
      statusText: '500',
      json: async () => ({}),
      text: async () => 'upstream down',
      body: null,
    });
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);
    seedAnthropicCredential(t);
    seedGroqCredential(t);

    const chatRes = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(chatRes.statusCode).toBe(500);
    const traceId = chatRes.headers['x-trace-id'] as string;
    expect(traceId).toBeDefined();

    const traceRes = await t.app.inject({
      method: 'GET',
      url: `/v1/traces/${traceId}`,
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(traceRes.statusCode).toBe(200);
    const trace = traceRes.json();
    const responseSpan = trace.spans.find((s: { name: string }) => s.name === 'response');
    expect(responseSpan.status).toBe('error');
    expect(responseSpan.attributes.failedModel).toBeDefined();
    // Multiple provider_call spans recorded: one per failed attempt (primary + fallbacks).
    const providerSpans = trace.spans.filter((s: { name: string }) => s.name === 'provider_call');
    expect(providerSpans.length).toBeGreaterThan(0);
    expect(providerSpans.every((s: { status: string }) => s.status === 'error')).toBe(true);
  });
});
