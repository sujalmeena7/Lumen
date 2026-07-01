import { describe, it, expect } from 'vitest';
import { requireModel } from '@router/core';
import { OpenAICompatibleAdapter } from './openai.js';
import { ProviderError } from './types.js';
import { createMockFetch } from '../test-utils/mockFetch.js';

const model = requireModel('gpt-4o-mini');
const ctx = { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' };

describe('OpenAICompatibleAdapter.chat (non-streaming)', () => {
  it('maps request fields and parses usage from the response', async () => {
    const { fetchFn, calls } = createMockFetch([
      {
        json: {
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1234,
          model: 'gpt-4o-mini',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      },
    ]);
    const adapter = new OpenAICompatibleAdapter('openai', fetchFn);
    const res = await adapter.chat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
      model,
      ctx,
    );

    expect(res.usage.total_tokens).toBe(15);
    expect(res.model).toBe('gpt-4o-mini'); // normalized to public id
    expect(res.choices[0]?.message.content).toBe('hi');

    const call = calls[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(call.init!.body as string);
    expect(body.model).toBe(model.providerModelId);
    expect(body.stream).toBe(false);
    expect(call.init!.headers!.authorization).toBe('Bearer sk-test');
  });

  it('throws a retryable ProviderError on 429', async () => {
    const { fetchFn } = createMockFetch([{ status: 429, text: 'rate limited' }]);
    const adapter = new OpenAICompatibleAdapter('openai', fetchFn);
    await expect(
      adapter.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }, model, ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof ProviderError && e.retryable === true);
  });

  it('throws a non-retryable ProviderError on 400', async () => {
    const { fetchFn } = createMockFetch([{ status: 400, text: 'bad request' }]);
    const adapter = new OpenAICompatibleAdapter('openai', fetchFn);
    await expect(
      adapter.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }, model, ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof ProviderError && e.retryable === false);
  });
});

describe('OpenAICompatibleAdapter.streamChat', () => {
  it('yields normalized chunks and stops at [DONE]', async () => {
    const { fetchFn } = createMockFetch([
      {
        sseLines: [
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
            choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          }),
          '[DONE]',
        ],
      },
    ]);
    const adapter = new OpenAICompatibleAdapter('openai', fetchFn);
    const chunks = [];
    for await (const c of adapter.streamChat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: true },
      model,
      ctx,
    )) {
      chunks.push(c);
    }
    expect(chunks).toHaveLength(2);
    const assembled = chunks.map((c) => c.choices[0]?.delta.content ?? '').join('');
    expect(assembled).toBe('Hello');
    expect(chunks[1]?.usage?.total_tokens).toBe(5);
  });
});
