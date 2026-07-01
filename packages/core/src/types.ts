/**
 * Shared domain types for the Dynamic Cost-Aware AI Router.
 * These are transport-agnostic: adapters translate provider payloads to/from
 * the OpenAI-shaped structures defined here.
 */

export type Provider = 'openai' | 'anthropic' | 'groq';

/** Coarse capability tier used by the router to bound candidate models. */
export type ModelTier = 'cheap' | 'standard' | 'frontier';

/**
 * Static, catalog-level metadata for a supported model.
 * Prices are USD per 1,000,000 (1M) tokens to keep the numbers human-readable;
 * cost math divides accordingly.
 */
export interface ModelSpec {
  /** Public model id exposed to clients (OpenAI-compatible naming). */
  id: string;
  provider: Provider;
  /** Provider-native model id used when calling the upstream API. */
  providerModelId: string;
  /** USD per 1M input (prompt) tokens. */
  inputPricePerMTok: number;
  /** USD per 1M output (completion) tokens. */
  outputPricePerMTok: number;
  /** Rough average end-to-end latency in ms (used as a routing signal). */
  avgLatencyMs: number;
  /** Normalized quality score in [0, 1]; higher is better. */
  qualityScore: number;
  tier: ModelTier;
  /** Context window in tokens. */
  contextWindow: number;
}

/** OpenAI-compatible chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

/** Normalized (OpenAI-shaped) chat completion request. */
export interface NormalizedChatRequest {
  /** Requested model id, or the virtual "auto" model to trigger routing. */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: unknown;
  user?: string;
}

/** Token usage as reported by the upstream provider. */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Normalized (OpenAI-shaped) non-streaming chat completion response. */
export interface NormalizedChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
  }>;
  usage: TokenUsage;
}

/** A single normalized streaming delta chunk (OpenAI-shaped). */
export interface NormalizedChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
  usage?: TokenUsage;
}

/** The virtual model id that triggers dynamic routing. */
export const AUTO_MODEL = 'auto';
