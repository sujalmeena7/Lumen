import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG,
  getModel,
  requireModel,
  modelsByProvider,
} from './catalog.js';

describe('model catalog', () => {
  it('contains all three providers', () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect(providers).toEqual(new Set(['openai', 'anthropic', 'groq']));
  });

  it('every model has valid, positive pricing and quality in [0,1]', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.inputPricePerMTok).toBeGreaterThan(0);
      expect(m.outputPricePerMTok).toBeGreaterThan(0);
      expect(m.qualityScore).toBeGreaterThanOrEqual(0);
      expect(m.qualityScore).toBeLessThanOrEqual(1);
      expect(m.contextWindow).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getModel returns undefined for unknown, spec for known', () => {
    expect(getModel('nope')).toBeUndefined();
    expect(getModel('gpt-4o')?.provider).toBe('openai');
  });

  it('requireModel throws for unknown', () => {
    expect(() => requireModel('nope')).toThrow();
  });

  it('modelsByProvider filters correctly', () => {
    expect(modelsByProvider('groq').every((m) => m.provider === 'groq')).toBe(true);
    expect(modelsByProvider('groq').length).toBeGreaterThan(0);
  });
});
