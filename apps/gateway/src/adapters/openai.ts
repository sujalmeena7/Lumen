import type {
  ModelSpec,
  NormalizedChatChunk,
  NormalizedChatRequest,
  NormalizedChatResponse,
  Provider,
} from '@router/core';
import {
  ProviderError,
  isRetryableStatus,
  type ChatCallContext,
  type FetchLike,
  type ProviderAdapter,
} from './types.js';
import { parseSseData } from './sse.js';

/**
 * Adapter for OpenAI's Chat Completions API. Because Groq exposes an
 * OpenAI-compatible surface, this class is parameterized by `provider` and can
 * back both. The wire format IS our normalized format, so mapping is minimal.
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(
    readonly provider: Provider,
    private readonly fetchFn: FetchLike,
  ) {}

  private buildBody(
    req: NormalizedChatRequest,
    model: ModelSpec,
    stream: boolean,
  ): string {
    const body: Record<string, unknown> = {
      model: model.providerModelId,
      messages: req.messages,
      stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.stop !== undefined) body.stop = req.stop;
    if (req.tools !== undefined) body.tools = req.tools;
    if (req.tool_choice !== undefined) body.tool_choice = req.tool_choice;
    if (stream) body.stream_options = { include_usage: true };
    return JSON.stringify(body);
  }

  private headers(ctx: ChatCallContext): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.apiKey}`,
    };
  }

  async chat(
    req: NormalizedChatRequest,
    model: ModelSpec,
    ctx: ChatCallContext,
  ): Promise<NormalizedChatResponse> {
    const res = await this.fetchFn(`${ctx.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: this.buildBody(req, model, false),
      signal: ctx.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new ProviderError(
        `${this.provider} error ${res.status}: ${text}`,
        res.status,
        this.provider,
        isRetryableStatus(res.status),
      );
    }
    const json = (await res.json()) as NormalizedChatResponse;
    // Ensure the response advertises the public model id, not the provider id.
    json.model = model.id;
    return json;
  }

  async *streamChat(
    req: NormalizedChatRequest,
    model: ModelSpec,
    ctx: ChatCallContext,
  ): AsyncGenerator<NormalizedChatChunk, void, unknown> {
    const res = await this.fetchFn(`${ctx.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: this.buildBody(req, model, true),
      signal: ctx.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new ProviderError(
        `${this.provider} error ${res.status}: ${text}`,
        res.status,
        this.provider,
        isRetryableStatus(res.status),
      );
    }
    for await (const data of parseSseData(res.body)) {
      if (data === '[DONE]') return;
      if (!data) continue;
      let chunk: NormalizedChatChunk;
      try {
        chunk = JSON.parse(data) as NormalizedChatChunk;
      } catch {
        continue; // skip keep-alive / malformed lines
      }
      chunk.model = model.id;
      yield chunk;
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
