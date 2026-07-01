import type { ChatMessage, ModelSpec, TokenUsage } from '../types.js';
import { requireModel } from '../models/catalog.js';

/**
 * Heuristic token estimator.
 *
 * A real tokenizer (tiktoken/gpt-tokenizer) is provider/model specific and adds
 * a heavy dependency. For *routing* decisions we only need a stable, cheap
 * estimate, so we approximate using a blend of character- and word-based
 * heuristics that tracks real tokenizers closely enough for tiering. Actual
 * billing always uses the provider-reported `usage`, never this estimate.
 */
export function estimateTokensForText(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // ~4 chars/token and ~0.75 words/token; average the two signals.
  const byChars = chars / 4;
  const byWords = words / 0.75;
  return Math.max(1, Math.round((byChars + byWords) / 2));
}

/** Estimate prompt tokens for a list of chat messages (adds small per-message overhead). */
export function estimatePromptTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // per-message role/formatting overhead, matching OpenAI's rough accounting
    if (typeof m.content === 'string') total += estimateTokensForText(m.content);
    if (m.name) total += estimateTokensForText(m.name);
  }
  return total + 2; // priming tokens
}

/**
 * Compute USD cost for a given model and token usage.
 * Prices in the catalog are per 1M tokens.
 */
export function computeCost(model: ModelSpec | string, usage: TokenUsage): number {
  const spec = typeof model === 'string' ? requireModel(model) : model;
  const inputCost = (usage.prompt_tokens / 1_000_000) * spec.inputPricePerMTok;
  const outputCost = (usage.completion_tokens / 1_000_000) * spec.outputPricePerMTok;
  return round6(inputCost + outputCost);
}

/**
 * Compute the "baseline" cost: what this exact usage WOULD have cost if the
 * premium baseline model (e.g. gpt-4o) had served every request. This powers
 * the "Money Saved" metric = baselineCost - actualCost.
 */
export function computeBaselineCost(
  usage: TokenUsage,
  baselineModelId = 'gpt-4o',
): number {
  return computeCost(baselineModelId, usage);
}

/** Money saved for a single request vs the premium baseline. */
export function computeSavings(
  actualModel: ModelSpec | string,
  usage: TokenUsage,
  baselineModelId = 'gpt-4o',
): { actualCost: number; baselineCost: number; saved: number } {
  const actualCost = computeCost(actualModel, usage);
  const baselineCost = computeBaselineCost(usage, baselineModelId);
  return { actualCost, baselineCost, saved: round6(baselineCost - actualCost) };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
