import type {
  ModelSpec,
  NormalizedChatChunk,
  NormalizedChatRequest,
  NormalizedChatResponse,
  Provider,
} from '@router/core';

/** Minimal fetch signature so adapters can be tested with a mock. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;
}

/** Context for a single upstream call. */
export interface ChatCallContext {
  /** Decrypted upstream provider API key. NEVER logged. */
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

/** Normalized error surfaced to the OpenAI-compatible error mapper. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: Provider,
    readonly retryable: boolean,
    readonly type = 'upstream_error',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderAdapter {
  readonly provider: Provider;
  /** Non-streaming chat completion. */
  chat(
    req: NormalizedChatRequest,
    model: ModelSpec,
    ctx: ChatCallContext,
  ): Promise<NormalizedChatResponse>;
  /** Streaming chat completion as normalized (OpenAI-shaped) chunks. */
  streamChat(
    req: NormalizedChatRequest,
    model: ModelSpec,
    ctx: ChatCallContext,
  ): AsyncGenerator<NormalizedChatChunk, void, unknown>;
}

/** Determine whether an HTTP status should be treated as retryable. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
