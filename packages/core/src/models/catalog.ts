import type { ModelSpec, Provider } from '../types.js';

/**
 * Static model catalog.
 *
 * Prices are indicative USD per 1M tokens (public list prices at time of
 * writing). They are intentionally centralized here so routing/cost math and
 * the "Money Saved" metric all read from a single source of truth. Update this
 * table as provider pricing changes.
 */
export const MODEL_CATALOG: ModelSpec[] = [
  // ---- OpenAI ----
  {
    id: 'gpt-4o',
    provider: 'openai',
    providerModelId: 'gpt-4o',
    inputPricePerMTok: 2.5,
    outputPricePerMTok: 10,
    avgLatencyMs: 1600,
    qualityScore: 0.95,
    tier: 'frontier',
    contextWindow: 128_000,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    providerModelId: 'gpt-4o-mini',
    inputPricePerMTok: 0.15,
    outputPricePerMTok: 0.6,
    avgLatencyMs: 900,
    qualityScore: 0.78,
    tier: 'standard',
    contextWindow: 128_000,
  },
  // ---- Anthropic ----
  {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    providerModelId: 'claude-3-5-sonnet-latest',
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    avgLatencyMs: 1800,
    qualityScore: 0.96,
    tier: 'frontier',
    contextWindow: 200_000,
  },
  {
    id: 'claude-3-5-haiku',
    provider: 'anthropic',
    providerModelId: 'claude-3-5-haiku-latest',
    inputPricePerMTok: 0.8,
    outputPricePerMTok: 4,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    tier: 'standard',
    contextWindow: 200_000,
  },
  // ---- Groq (Llama 3) ----
  {
    id: 'llama-3.1-8b',
    provider: 'groq',
    providerModelId: 'llama-3.1-8b-instant',
    inputPricePerMTok: 0.05,
    outputPricePerMTok: 0.08,
    avgLatencyMs: 300,
    qualityScore: 0.6,
    tier: 'cheap',
    contextWindow: 128_000,
  },
  {
    id: 'llama-3.3-70b',
    provider: 'groq',
    providerModelId: 'llama-3.3-70b-versatile',
    inputPricePerMTok: 0.59,
    outputPricePerMTok: 0.79,
    avgLatencyMs: 500,
    qualityScore: 0.82,
    tier: 'standard',
    contextWindow: 128_000,
  },
];

const byId = new Map<string, ModelSpec>(MODEL_CATALOG.map((m) => [m.id, m]));

/** Look up a model spec by its public id. Returns undefined if unknown. */
export function getModel(id: string): ModelSpec | undefined {
  return byId.get(id);
}

/** Look up a model spec or throw if the id is not in the catalog. */
export function requireModel(id: string): ModelSpec {
  const spec = byId.get(id);
  if (!spec) throw new Error(`Unknown model: ${id}`);
  return spec;
}

/** All models for a given provider. */
export function modelsByProvider(provider: Provider): ModelSpec[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}
