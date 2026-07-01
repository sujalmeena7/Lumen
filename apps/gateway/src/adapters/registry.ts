import type { Provider } from '@router/core';
import type { FetchLike, ProviderAdapter } from './types.js';
import { OpenAICompatibleAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

/** Builds the provider -> adapter map. `fetchFn` is injected for testability. */
export function createAdapterRegistry(fetchFn: FetchLike): Record<Provider, ProviderAdapter> {
  return {
    openai: new OpenAICompatibleAdapter('openai', fetchFn),
    groq: new OpenAICompatibleAdapter('groq', fetchFn),
    anthropic: new AnthropicAdapter(fetchFn),
  };
}

export type AdapterRegistry = Record<Provider, ProviderAdapter>;
