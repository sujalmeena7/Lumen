import type {
  ChatMessage,
  ModelSpec,
  NormalizedChatChunk,
  NormalizedChatRequest,
  NormalizedChatResponse,
} from '@router/core';
import {
  ProviderError,
  isRetryableStatus,
  type ChatCallContext,
  type FetchLike,
  type ProviderAdapter,
} from './types.js';
import { parseSseData } from './sse.js';

/** Map an OpenAI-shaped finish reason from Anthropic's `stop_reason`. */
function mapStopReason(stopReason: string | null | undefined): string | null {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return stopReason ?? null;
  }
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  content_block?: AnthropicContentBlock;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  usage?: { output_tokens: number };
}

/** Splits OpenAI-style messages into an Anthropic `system` string + turn list. */
function splitSystemAndTurns(messages: ChatMessage[]): {
  system: string | undefined;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') continue; // tool-result mapping is out of scope for v1
    turns.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : '',
    });
  }
  return { system: systemParts.length ? systemParts.join('\n') : undefined, turns };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;

  constructor(private readonly fetchFn: FetchLike) {}

  private headers(ctx: ChatCallContext): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': ctx.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private buildBody(req: NormalizedChatRequest, model: ModelSpec, stream: boolean) {
    const { system, turns } = splitSystemAndTurns(req.messages);
    const body: Record<string, unknown> = {
      model: model.providerModelId,
      max_tokens: req.max_tokens ?? 1024,
      messages: turns,
      stream,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop !== undefined) {
      body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
    }
    return JSON.stringify(body);
  }

  async chat(
    req: NormalizedChatRequest,
    model: ModelSpec,
    ctx: ChatCallContext,
  ): Promise<NormalizedChatResponse> {
    const res = await this.fetchFn(`${ctx.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: this.buildBody(req, model, false),
      signal: ctx.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new ProviderError(
        `anthropic error ${res.status}: ${text}`,
        res.status,
        'anthropic',
        isRetryableStatus(res.status),
      );
    }
    const json = (await res.json()) as AnthropicResponse;
    const text = json.content.find((c) => c.type === 'text')?.text ?? '';
    const promptTokens = json.usage.input_tokens;
    const completionTokens = json.usage.output_tokens;
    return {
      id: json.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: mapStopReason(json.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  async *streamChat(
    req: NormalizedChatRequest,
    model: ModelSpec,
    ctx: ChatCallContext,
  ): AsyncGenerator<NormalizedChatChunk, void, unknown> {
    const res = await this.fetchFn(`${ctx.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: this.buildBody(req, model, true),
      signal: ctx.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new ProviderError(
        `anthropic error ${res.status}: ${text}`,
        res.status,
        'anthropic',
        isRetryableStatus(res.status),
      );
    }

    const id = `anthropic-${Date.now()}`;
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const data of parseSseData(res.body)) {
      if (!data) continue;
      let evt: AnthropicStreamEvent;
      try {
        evt = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      if (evt.type === 'message_start' && evt.message?.usage) {
        promptTokens = evt.message.usage.input_tokens;
      }

      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        yield {
          id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model.id,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: evt.delta.text ?? '' },
              finish_reason: null,
            },
          ],
        };
      }

      if (evt.type === 'message_delta') {
        if (evt.usage?.output_tokens !== undefined) {
          completionTokens = evt.usage.output_tokens;
        }
        const stopReason = evt.delta?.stop_reason;
        if (stopReason) {
          yield {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(stopReason) }],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          };
        }
      }

      if (evt.type === 'message_stop') {
        return;
      }
    }
  }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
