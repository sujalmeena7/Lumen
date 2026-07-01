import { describe, it, expect } from 'vitest';
import {
  computeCost,
  computeBaselineCost,
  computeSavings,
  estimateTokensForText,
  estimatePromptTokens,
} from './cost.js';
import type { TokenUsage } from '../types.js';

const usage: TokenUsage = {
  prompt_tokens: 1000,
  completion_tokens: 500,
  total_tokens: 1500,
};

describe('cost math', () => {
  it('computes cost for gpt-4o from catalog prices (per 1M tokens)', () => {
    // gpt-4o: input 2.5/M, output 10/M => 1000*2.5/1e6 + 500*10/1e6
    const expected = (1000 * 2.5) / 1e6 + (500 * 10) / 1e6;
    expect(computeCost('gpt-4o', usage)).toBeCloseTo(expected, 9);
  });

  it('cheap model costs strictly less than frontier for same usage', () => {
    expect(computeCost('llama-3.1-8b', usage)).toBeLessThan(computeCost('gpt-4o', usage));
  });

  it('baseline cost equals gpt-4o cost by default', () => {
    expect(computeBaselineCost(usage)).toBeCloseTo(computeCost('gpt-4o', usage), 9);
  });

  it('computeSavings yields positive savings when a cheap model is used', () => {
    const { actualCost, baselineCost, saved } = computeSavings('llama-3.1-8b', usage);
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeCloseTo(baselineCost - actualCost, 9);
  });

  it('throws on unknown model', () => {
    expect(() => computeCost('does-not-exist', usage)).toThrow(/Unknown model/);
  });
});

describe('token estimation', () => {
  it('empty text is zero tokens', () => {
    expect(estimateTokensForText('')).toBe(0);
  });

  it('estimates grow monotonically with text length', () => {
    const short = estimateTokensForText('hello world');
    const long = estimateTokensForText('hello world '.repeat(50));
    expect(long).toBeGreaterThan(short);
  });

  it('prompt token estimate accounts for multiple messages', () => {
    const single = estimatePromptTokens([{ role: 'user', content: 'hi there friend' }]);
    const multi = estimatePromptTokens([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hi there friend' },
    ]);
    expect(multi).toBeGreaterThan(single);
  });
});
