import type { Provider } from '@router/core';
import type { AnalyticsSummary, ModelBreakdownEntry } from './types.js';

/** Minimal shape of a RequestLog row needed to compute the ROI summary (Task 18). */
export interface AnalyticsSourceRow {
  chosenModel: string;
  provider: Provider;
  costUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  latencyMs: number;
  cacheHit: boolean;
  status: 'success' | 'error' | 'blocked';
}

/**
 * Pure aggregation function shared by every `RequestLogStore` implementation
 * (in-memory for tests, Prisma for production) so the ROI dashboard's math
 * has exactly one implementation, directly unit-testable without a DB.
 */
export function computeAnalyticsSummary(rows: AnalyticsSourceRow[]): AnalyticsSummary {
  const totalRequests = rows.length;
  const successfulRequests = rows.filter((r) => r.status === 'success').length;
  const errorRequests = rows.filter((r) => r.status === 'error').length;
  const blockedRequests = rows.filter((r) => r.status === 'blocked').length;
  const cacheHitCount = rows.filter((r) => r.cacheHit).length;

  const totalLatency = rows.reduce((sum, r) => sum + r.latencyMs, 0);
  const avgLatencyMs = totalRequests > 0 ? totalLatency / totalRequests : 0;

  const nonCached = rows.filter((r) => !r.cacheHit);
  const avgLatencyMsNonCached =
    nonCached.length > 0 ? nonCached.reduce((sum, r) => sum + r.latencyMs, 0) / nonCached.length : 0;

  const totalCostUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
  const totalBaselineCostUsd = rows.reduce((sum, r) => sum + r.baselineCostUsd, 0);
  const totalSavedUsd = rows.reduce((sum, r) => sum + r.savedUsd, 0);
  const savedPercent = totalBaselineCostUsd > 0 ? (totalSavedUsd / totalBaselineCostUsd) * 100 : 0;

  const byModelMap = new Map<string, ModelBreakdownEntry & { _latencySum: number }>();
  for (const row of rows) {
    const key = row.chosenModel;
    const existing = byModelMap.get(key);
    if (existing) {
      existing.requests += 1;
      existing.totalCostUsd += row.costUsd;
      existing.totalSavedUsd += row.savedUsd;
      existing._latencySum += row.latencyMs;
    } else {
      byModelMap.set(key, {
        model: row.chosenModel,
        provider: row.provider,
        requests: 1,
        totalCostUsd: row.costUsd,
        totalSavedUsd: row.savedUsd,
        avgLatencyMs: 0,
        _latencySum: row.latencyMs,
      });
    }
  }
  const byModel: ModelBreakdownEntry[] = [...byModelMap.values()]
    .map((entry) => ({
      model: entry.model,
      provider: entry.provider,
      requests: entry.requests,
      totalCostUsd: round2(entry.totalCostUsd),
      totalSavedUsd: round2(entry.totalSavedUsd),
      avgLatencyMs: Math.round(entry._latencySum / entry.requests),
    }))
    .sort((a, b) => b.requests - a.requests);

  return {
    totalRequests,
    successfulRequests,
    errorRequests,
    blockedRequests,
    avgLatencyMs: Math.round(avgLatencyMs),
    avgLatencyMsNonCached: Math.round(avgLatencyMsNonCached),
    cacheHitCount,
    cacheHitRate: totalRequests > 0 ? cacheHitCount / totalRequests : 0,
    totalCostUsd: round2(totalCostUsd),
    totalBaselineCostUsd: round2(totalBaselineCostUsd),
    totalSavedUsd: round2(totalSavedUsd),
    savedPercent: round2(savedPercent),
    byModel,
  };
}

function round2(n: number): number {
  // 4 decimal places: LLM per-request costs are frequently fractions of a
  // cent (e.g. $0.0003), so 2 decimals would silently round small-but-real
  // savings down to $0.00 and misrepresent the "Money Saved" headline.
  return Math.round(n * 10000) / 10000;
}
