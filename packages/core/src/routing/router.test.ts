import { describe, it, expect } from 'vitest';
import { scoreComplexity } from './complexity.js';
import {
  route,
  tierFloorForComplexity,
  DEFAULT_WEIGHTS,
  fallbackCandidates,
  type RoutingWeights,
} from './router.js';
import { requireModel } from '../models/catalog.js';
import type { ChatMessage } from '../types.js';

const msg = (content: string): ChatMessage[] => [{ role: 'user', content }];

describe('complexity scorer', () => {
  it('scores a simple extraction task low', () => {
    const { score } = scoreComplexity(msg('Extract the date from this text: Meeting on 2024-01-05.'));
    expect(score).toBeLessThan(0.3);
  });

  it('scores a simple classification task low', () => {
    const { score } = scoreComplexity(msg('Classify this review as positive or negative: great!'));
    expect(score).toBeLessThan(0.3);
  });

  it('scores a multi-step reasoning + code task high', () => {
    const prompt =
      'Analyze this algorithm step by step and prove its time complexity, then ' +
      'refactor and optimize it:\n```python\ndef f(n):\n  return sum(range(n))\n```\n' +
      'Why is your approach better? What are the trade-offs?';
    const { score } = scoreComplexity(msg(prompt));
    expect(score).toBeGreaterThan(0.6);
  });

  it('exposes individual signals', () => {
    const { signals } = scoreComplexity(msg('```js\nconsole.log(1)\n``` explain why'));
    expect(signals).toHaveProperty('codeBlocks');
    expect(signals).toHaveProperty('reasoningKeywords');
    expect(signals.codeBlocks).toBeGreaterThan(0);
  });
});

describe('tier floor mapping', () => {
  it('maps score ranges to tiers', () => {
    expect(tierFloorForComplexity(0.1)).toBe('cheap');
    expect(tierFloorForComplexity(0.45)).toBe('standard');
    expect(tierFloorForComplexity(0.8)).toBe('frontier');
  });
});

describe('argmin router', () => {
  it('routes a trivial task to a cheap/standard model, never frontier', () => {
    const decision = route(msg('Translate "hello" to French.'));
    expect(decision.model.tier).not.toBe('frontier');
  });

  it('routes a hard reasoning task to a frontier model', () => {
    const prompt =
      'Design a distributed architecture and prove step by step why it scales; ' +
      'analyze the trade-offs and optimize the algorithm.\n```\ncode\n```\nWhy? How?';
    const decision = route(msg(prompt));
    expect(decision.model.tier).toBe('frontier');
  });

  it('respects the context window (excludes models too small)', () => {
    // Build a catalog where only a large-context model can fit a huge prompt.
    const huge = 'word '.repeat(5000);
    const decision = route(msg(huge));
    expect(decision.model.contextWindow).toBeGreaterThanOrEqual(decision.complexity.promptTokens);
  });

  it('increasing the cost weight shifts selection toward cheaper models', () => {
    const prompt = 'Summarize this paragraph in one sentence.';
    const cheapWeights: RoutingWeights = { cost: 5, latency: 0.3, quality: 0.2 };
    const qualityWeights: RoutingWeights = { cost: 0.1, latency: 0.1, quality: 5 };
    const cheap = route(msg(prompt), { weights: cheapWeights });
    const quality = route(msg(prompt), { weights: qualityWeights });
    expect(cheap.model.inputPricePerMTok).toBeLessThanOrEqual(quality.model.inputPricePerMTok);
  });

  it('quality-heavy weights pick the highest-quality eligible model', () => {
    const catalog = [
      { id: 'a', provider: 'groq', providerModelId: 'a', inputPricePerMTok: 0.05, outputPricePerMTok: 0.08, avgLatencyMs: 300, qualityScore: 0.6, tier: 'cheap', contextWindow: 128000 },
      { id: 'b', provider: 'openai', providerModelId: 'b', inputPricePerMTok: 0.15, outputPricePerMTok: 0.6, avgLatencyMs: 900, qualityScore: 0.78, tier: 'cheap', contextWindow: 128000 },
    ] as const;
    const decision = route(msg('Write a haiku.'), {
      weights: { cost: 0, latency: 0, quality: 10 },
      catalog: [...catalog],
    });
    // With only quality mattering, the higher qualityScore model must win.
    expect(decision.model.id).toBe('b');
  });

  it('exposes ranked candidates and a human-readable reason', () => {
    const decision = route(msg('Explain why the sky is blue, step by step.'));
    expect(decision.candidates.length).toBeGreaterThan(0);
    expect(decision.reason).toMatch(/complexity=/);
    // candidates sorted ascending by objective (best first)
    const objs = decision.candidates.map((c) => c.objective);
    expect([...objs].sort((a, b) => a - b)).toEqual(objs);
  });

  it('default weights are exported and sane', () => {
    expect(DEFAULT_WEIGHTS.cost).toBeGreaterThan(0);
    expect(DEFAULT_WEIGHTS.quality).toBeGreaterThan(0);
  });
});

describe('fallbackCandidates', () => {
  it('excludes the failed model and never suggests a lower tier', () => {
    const gpt4o = requireModel('gpt-4o');
    const candidates = fallbackCandidates(gpt4o);
    expect(candidates.some((c) => c.id === gpt4o.id)).toBe(false);
    expect(candidates.every((c) => c.tier === 'frontier')).toBe(true);
  });

  it('returns standard-or-frontier candidates for a standard-tier failure', () => {
    const haiku = requireModel('claude-3-5-haiku');
    const candidates = fallbackCandidates(haiku);
    expect(candidates.every((c) => c.tier === 'standard' || c.tier === 'frontier')).toBe(true);
    expect(candidates.some((c) => c.id === haiku.id)).toBe(false);
  });

  it('returns an empty array when no other eligible model exists', () => {
    const gpt4o = requireModel('gpt-4o');
    const candidates = fallbackCandidates(gpt4o, { catalog: [gpt4o] });
    expect(candidates).toEqual([]);
  });

  it('orders candidates by the argmin objective (best first)', () => {
    const gpt4o = requireModel('gpt-4o');
    const candidates = fallbackCandidates(gpt4o, { weights: { cost: 0, latency: 0, quality: 10 } });
    // With quality dominating, the highest qualityScore frontier model wins.
    expect(candidates[0]?.qualityScore).toBeGreaterThanOrEqual(candidates[candidates.length - 1]?.qualityScore ?? 0);
  });
});
