import type { ChatMessage, ModelSpec, ModelTier } from '../types.js';
import { MODEL_CATALOG } from '../models/catalog.js';
import { estimatePromptTokens } from '../pricing/cost.js';
import { scoreComplexity, type ComplexityResult } from './complexity.js';

/**
 * Routing weights for the objective function:
 *   R = argmin( w1 * NormCost + w2 * NormLatency - w3 * Quality )
 * over the candidate set. Weights are configurable per workspace.
 */
export interface RoutingWeights {
  cost: number; // w1
  latency: number; // w2
  quality: number; // w3
}

export const DEFAULT_WEIGHTS: RoutingWeights = { cost: 1, latency: 0.3, quality: 1.2 };

export interface RoutingDecision {
  model: ModelSpec;
  score: number; // objective value (lower is better)
  complexity: ComplexityResult;
  candidates: Array<{ id: string; objective: number }>;
  reason: string;
}

/**
 * Map a complexity score to the minimum acceptable tier. This bounds the
 * candidate set so we never send a trivial prompt to a frontier model, nor a
 * hard reasoning task to a tiny model.
 */
export function tierFloorForComplexity(score: number): ModelTier {
  if (score >= 0.6) return 'frontier';
  if (score >= 0.3) return 'standard';
  return 'cheap';
}

const TIER_RANK: Record<ModelTier, number> = { cheap: 0, standard: 1, frontier: 2 };

/**
 * Estimate the per-request cost of a model for the objective function. We use
 * the estimated prompt tokens and assume a modest completion (proportional to
 * prompt, capped) so cost differences between models are meaningful pre-flight.
 */
function estimateRequestCost(spec: ModelSpec, promptTokens: number): number {
  const assumedCompletion = Math.min(Math.max(promptTokens * 0.5, 64), 1024);
  const input = (promptTokens / 1_000_000) * spec.inputPricePerMTok;
  const output = (assumedCompletion / 1_000_000) * spec.outputPricePerMTok;
  return input + output;
}

/**
 * Core routing engine. Given the request messages and weights, returns the
 * model that minimizes the objective function over the eligible candidate set.
 *
 * Pure function: no I/O, fully unit-testable.
 */
export function route(
  messages: ChatMessage[],
  opts: { weights?: RoutingWeights; catalog?: ModelSpec[] } = {},
): RoutingDecision {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const catalog = opts.catalog ?? MODEL_CATALOG;
  const complexity = scoreComplexity(messages);
  const promptTokens = estimatePromptTokens(messages);

  const floor = tierFloorForComplexity(complexity.score);
  const eligible = catalog.filter(
    (m) => TIER_RANK[m.tier] >= TIER_RANK[floor] && m.contextWindow >= promptTokens,
  );
  const candidates = eligible.length > 0 ? eligible : [...catalog];

  // Normalize cost and latency across candidates so weights are comparable.
  const costs = candidates.map((m) => estimateRequestCost(m, promptTokens));
  const latencies = candidates.map((m) => m.avgLatencyMs);
  const maxCost = Math.max(...costs, Number.EPSILON);
  const maxLatency = Math.max(...latencies, 1);

  const scored = candidates.map((m, i) => {
    const normCost = costs[i]! / maxCost;
    const normLatency = latencies[i]! / maxLatency;
    const objective =
      weights.cost * normCost +
      weights.latency * normLatency -
      weights.quality * m.qualityScore;
    return { spec: m, objective };
  });

  scored.sort((a, b) => a.objective - b.objective);
  const best = scored[0]!;

  return {
    model: best.spec,
    score: best.objective,
    complexity,
    candidates: scored.map((s) => ({ id: s.spec.id, objective: round4(s.objective) })),
    reason: `complexity=${complexity.score.toFixed(2)} floor=${floor} chose ${best.spec.id}`,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Returns fallback candidates for a failed model: other models of the same
 * or higher tier (never downgrading quality expectations), excluding the
 * failed model itself, ordered by the same argmin objective used for initial
 * routing. Used by the resiliency layer (Task 11) to pick a same-quality
 * substitute when the primary model errors or rate-limits.
 */
export function fallbackCandidates(
  failedModel: ModelSpec,
  opts: { weights?: RoutingWeights; catalog?: ModelSpec[]; promptTokens?: number } = {},
): ModelSpec[] {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const catalog = opts.catalog ?? MODEL_CATALOG;
  const promptTokens = opts.promptTokens ?? 0;

  const candidates = catalog.filter(
    (m) =>
      m.id !== failedModel.id &&
      TIER_RANK[m.tier] >= TIER_RANK[failedModel.tier] &&
      m.contextWindow >= promptTokens,
  );
  if (candidates.length === 0) return [];

  const costs = candidates.map((m) => estimateRequestCost(m, promptTokens));
  const latencies = candidates.map((m) => m.avgLatencyMs);
  const maxCost = Math.max(...costs, Number.EPSILON);
  const maxLatency = Math.max(...latencies, 1);

  return candidates
    .map((m, i) => {
      const normCost = costs[i]! / maxCost;
      const normLatency = latencies[i]! / maxLatency;
      const objective =
        weights.cost * normCost + weights.latency * normLatency - weights.quality * m.qualityScore;
      return { spec: m, objective };
    })
    .sort((a, b) => a.objective - b.objective)
    .map((s) => s.spec);
}
