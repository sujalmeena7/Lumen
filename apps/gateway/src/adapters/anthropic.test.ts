import { describe, it, expect } from 'vitest';
import { requireModel } from '@router/core';
import { AnthropicAdapter } from './anthropic.js';
import { ProviderError } from './types.js';
import { createMockFetch } from '../test-utils/mockFetch.js';

const model = requireModel('claude-3-5-haiku');
const ctx = { apiKey: 'sk-ant-test', baseUrl: 'https://api.anthropic.com/v1' };

describe('AnthropicAdapter.chat (non-streaming)', () => {
  it('maps system message, turns, and usage correctly', async () => {
    const { fetchFn, calls } = createMockFetch([
      {
        json: {
          id: 'msg_1',
          content: [{ type: 'text', text: 'Hello there' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 4 },
        },
      },
    ]);
    const adapter = new AnthropicAdapter(fetchFn);
    const res = await adapter.chat(
      {
        model: 'claude-3-5-haiku',
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'user', content: 'hi' },
        ],
      },
      model,
      ctx,
    );

    expect(res.choices[0]?.message.content).toBe('Hello there');
    expect(res.choices[0]?.finish_reason).toBe('stop'); // mapped from end_turn
    expect(res.usage.total_tokens).toBe(16);
    expect(res.model).toBe('claude-3-5-haiku');

    const call = calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.init!.headers!['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(call.init!.body as string);
    expect(body.system).toBe('be nice');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('maps max_tokens stop reason to length', async () => {
    const { fetchFn } = createMockFetch([
      {
        json: {
          id: 'msg_2',
          content: [{ type: 'text', text: 'partial' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 5, output_tokens: 100 },
        },
      },
    ]);
    const adapter = new AnthropicAdapter(fetchFn);
    const res = await adapter.chat(
      { model: 'claude-3-5-haiku', messages: [{ role: 'user', content: 'hi' }] },
      model,
      ctx,
    );
    expect(res.choices[0]?.finish_reason).toBe('length');
  });

  it('throws ProviderError on non-2xx', async () => {
    const { fetchFn } = createMockFetch([{ status: 529, text: 'overloaded' }]);
    const adapter = new AnthropicAdapter(fetchFn);
    await expect(
      adapter.chat({ model: 'claude-3-5-haiku', messages: [{ role: 'user', content: 'hi' }] }, model, ctx),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('AnthropicAdapter.streamChat', () => {
  it('assembles text deltas and reports usage on message_delta', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 8, output_tokens: 0 } } },
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ];
    const { fetchFn } = createMockFetch([{ sseLines: events.map((e) => JSON.stringify(e)) }]);
    const adapter = new AnthropicAdapter(fetchFn);
    const chunks = [];
    for await (const c of adapter.streamChat(
      { model: 'claude-3-5-haiku', messages: [{ role: 'user', content: 'hi' }], stream: true },
      model,
      ctx,
    )) {
      chunks.push(c);
    }
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? '').join('');
    expect(text).toBe('Hi there');
    const last = chunks[chunks.length - 1]!;
    expect(last.choices[0]?.finish_reason).toBe('stop');
    expect(last.usage).toEqual({ prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 });
  });
});
