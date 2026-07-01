import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';
import { createMockFetch } from '../test-utils/mockFetch.js';
import type { FetchLike } from '../adapters/types.js';

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

describe('/v1/chat/completions (non-streaming)', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('forwards to the requested model via the adapter and returns an OpenAI-shaped response', async () => {
    const { fetchFn } = createMockFetch([
      {
        json: {
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        },
      },
    ]);
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
    const body = res.json();
    expect(body.choices[0].message.content).toBe('hello!');
    expect(body.usage.total_tokens).toBe(7);
    expect(res.headers['x-router-model']).toBe('gpt-4o-mini');
    expect(t.stores.logs).toHaveLength(1);
    expect(t.stores.logs[0]!.status).toBe('success');
  });

  it('never sends the plaintext provider key to the client', async () => {
    const { fetchFn } = createMockFetch([
      {
        json: {
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      },
    ]);
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(JSON.stringify(res.json())).not.toContain('sk-openai-fake-key');
  });

  it('rejects invalid request bodies with 400', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini' }, // missing messages
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
  });

  it('returns 400 model_not_found for an unknown explicit model', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'not-a-real-model', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('model_not_found');
  });

  it('routes "auto" to a cheap model for a trivial prompt and exposes router headers', async () => {
    const { fetchFn } = createMockFetch([
      {
        json: {
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'llama-3.1-8b',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        },
      },
    ]);
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedGroqCredential(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'auto', messages: [{ role: 'user', content: 'Translate hello to French.' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-router-model']).toBeDefined();
    expect(res.headers['x-router-score']).toBeDefined();
    expect(t.stores.logs[0]!.complexityScore).not.toBeNull();
  });

  it('routes "auto" to a frontier-tier model for a hard reasoning prompt', async () => {
    const { fetchFn } = createMockFetch([
      {
        json: {
          id: 'chatcmpl-x',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'deep answer' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        },
      },
    ]);
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);
    seedAnthropicCredential(t);
    const prompt =
      'Design a distributed system architecture, prove step by step why it scales, ' +
      'analyze the trade-offs, and optimize this algorithm:\n```\ncode here\n```\nWhy? How?';
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'auto', messages: [{ role: 'user', content: prompt }] },
    });
    expect(res.statusCode).toBe(200);
    // Frontier tier = gpt-4o or claude-3-5-sonnet; router picks the argmin of the two.
    expect(['gpt-4o', 'claude-3-5-sonnet']).toContain(res.headers['x-router-model']);
    expect(Number(res.headers['x-router-score'])).toBeGreaterThan(0.6);
  });
});

describe('/v1/chat/completions (streaming)', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('streams SSE chunks that assemble into the full message and logs usage', async () => {
    const sseLines = [
      JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }],
      }),
      JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, delta: { content: 'lo!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }),
      '[DONE]',
    ];
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      body: (async function* () {
        yield new TextEncoder().encode(sseLines.map((l) => `data: ${l}\n\n`).join(''));
      })(),
    });

    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = res.payload
      .split('\n\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    expect(events[events.length - 1]).toBe('[DONE]');
    const dataEvents = events.slice(0, -1).map((e) => JSON.parse(e));
    const assembled = dataEvents.map((c) => c.choices[0]?.delta?.content ?? '').join('');
    expect(assembled).toBe('Hello!');

    expect(t.stores.logs).toHaveLength(1);
    expect(t.stores.logs[0]!.totalTokens).toBe(6);
  });
});
