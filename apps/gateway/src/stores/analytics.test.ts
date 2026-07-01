import { describe, it, expect } from 'vitest';
import { computeAnalyticsSummary, type AnalyticsSourceRow } from './analytics.js';

function row(overrides: Partial<AnalyticsSourceRow> = {}): AnalyticsSourceRow {
  return {
    chosenModel: 'gpt-4o-mini',
    provider: 'openai',
    costUsd: 0.01,
    baselineCostUsd: 0.05,
    savedUsd: 0.04,
    latencyMs: 500,
    cacheHit: false,
    status: 'success',
    ...overrides,
  };
}

describe('computeAnalyticsSummary', () => {
  it('returns a well-formed empty state for no requests', () => {
    const summary = computeAnalyticsSummary([]);
    expect(summary).toEqual({
      totalRequests: 0,
      successfulRequests: 0,
      errorRequests: 0,
      blockedRequests: 0,
      avgLatencyMs: 0,
      avgLatencyMsNonCached: 0,
      cacheHitCount: 0,
      cacheHitRate: 0,
      totalCostUsd: 0,
      totalBaselineCostUsd: 0,
      totalSavedUsd: 0,
      savedPercent: 0,
      byModel: [],
    });
  });

  it('computes totals, averages, and Money Saved across a fixed fixture', () => {
    const rows: AnalyticsSourceRow[] = [
      row({ chosenModel: 'gpt-4o-mini', costUsd: 0.01, baselineCostUsd: 0.05, savedUsd: 0.04, latencyMs: 400 }),
      row({ chosenModel: 'claude-3-haiku', provider: 'anthropic', costUsd: 0.02, baselineCostUsd: 0.06, savedUsd: 0.04, latencyMs: 600 }),
      row({ chosenModel: 'gpt-4o', costUsd: 0.1, baselineCostUsd: 0.1, savedUsd: 0, latencyMs: 800, status: 'success' }),
    ];
    const summary = computeAnalyticsSummary(rows);

    expect(summary.totalRequests).toBe(3);
    expect(summary.successfulRequests).toBe(3);
    expect(summary.avgLatencyMs).toBe(600); // (400+600+800)/3
    expect(summary.totalCostUsd).toBe(0.13);
    expect(summary.totalBaselineCostUsd).toBe(0.21);
    expect(summary.totalSavedUsd).toBe(0.08);
    expect(summary.savedPercent).toBeCloseTo((0.08 / 0.21) * 100, 2);
  });

  it('counts cache hits and excludes them from the non-cached latency average', () => {
    const rows: AnalyticsSourceRow[] = [
      row({ cacheHit: true, latencyMs: 5, costUsd: 0, savedUsd: 0.05, baselineCostUsd: 0.05 }),
      row({ cacheHit: false, latencyMs: 1000 }),
    ];
    const summary = computeAnalyticsSummary(rows);

    expect(summary.cacheHitCount).toBe(1);
    expect(summary.cacheHitRate).toBeCloseTo(0.5, 5);
    expect(summary.avgLatencyMsNonCached).toBe(1000);
    expect(summary.avgLatencyMs).toBe(Math.round((5 + 1000) / 2));
  });

  it('counts error and blocked requests separately from successful ones', () => {
    const rows: AnalyticsSourceRow[] = [
      row({ status: 'success' }),
      row({ status: 'error', costUsd: 0, savedUsd: 0, baselineCostUsd: 0 }),
      row({ status: 'blocked', costUsd: 0, savedUsd: 0, baselineCostUsd: 0 }),
    ];
    const summary = computeAnalyticsSummary(rows);

    expect(summary.totalRequests).toBe(3);
    expect(summary.successfulRequests).toBe(1);
    expect(summary.errorRequests).toBe(1);
    expect(summary.blockedRequests).toBe(1);
  });

  it('groups the per-model breakdown correctly and sorts by request count descending', () => {
    const rows: AnalyticsSourceRow[] = [
      row({ chosenModel: 'gpt-4o-mini', latencyMs: 100 }),
      row({ chosenModel: 'gpt-4o-mini', latencyMs: 300 }),
      row({ chosenModel: 'claude-3-haiku', provider: 'anthropic', latencyMs: 200 }),
    ];
    const summary = computeAnalyticsSummary(rows);

    expect(summary.byModel).toHaveLength(2);
    expect(summary.byModel[0]).toMatchObject({ model: 'gpt-4o-mini', requests: 2, avgLatencyMs: 200 });
    expect(summary.byModel[1]).toMatchObject({ model: 'claude-3-haiku', requests: 1, avgLatencyMs: 200 });
  });

  it('reports 0% saved (not NaN/Infinity) when baseline cost is zero', () => {
    const rows: AnalyticsSourceRow[] = [row({ baselineCostUsd: 0, savedUsd: 0, costUsd: 0 })];
    const summary = computeAnalyticsSummary(rows);
    expect(summary.savedPercent).toBe(0);
    expect(Number.isFinite(summary.savedPercent)).toBe(true);
  });

  it('preserves small-but-real fractional-cent costs/savings instead of rounding them to zero', () => {
    // Realistic Groq/cheap-model per-request costs are fractions of a cent.
    const rows: AnalyticsSourceRow[] = [
      row({ costUsd: 0.000003, baselineCostUsd: 0.00014, savedUsd: 0.000137 }),
      row({ costUsd: 0.000048, baselineCostUsd: 0.00035, savedUsd: 0.000302 }),
    ];
    const summary = computeAnalyticsSummary(rows);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(summary.totalSavedUsd).toBeGreaterThan(0);
    expect(summary.totalCostUsd).toBe(0.0001); // (0.000003+0.000048) rounded to 4dp
    expect(summary.totalSavedUsd).toBe(0.0004); // (0.000137+0.000302) rounded to 4dp
  });
});
