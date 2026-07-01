import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AnalyticsOverview from './AnalyticsOverview';

function emptySummary() {
  return {
    range: { since: '2026-06-01T00:00:00.000Z', until: '2026-07-01T00:00:00.000Z' },
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
  };
}

function populatedSummary() {
  return {
    range: { since: '2026-06-01T00:00:00.000Z', until: '2026-07-01T00:00:00.000Z' },
    totalRequests: 10,
    successfulRequests: 9,
    errorRequests: 1,
    blockedRequests: 0,
    avgLatencyMs: 450,
    avgLatencyMsNonCached: 500,
    cacheHitCount: 2,
    cacheHitRate: 0.2,
    totalCostUsd: 0.5,
    totalBaselineCostUsd: 2.0,
    totalSavedUsd: 1.5,
    savedPercent: 75,
    byModel: [
      { model: 'gpt-4o-mini', provider: 'openai', requests: 7, totalCostUsd: 0.3, totalSavedUsd: 1.0, avgLatencyMs: 400 },
      { model: 'claude-3-haiku', provider: 'anthropic', requests: 3, totalCostUsd: 0.2, totalSavedUsd: 0.5, avgLatencyMs: 600 },
    ],
  };
}

describe('AnalyticsOverview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an empty state with guidance when there are no requests', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => emptySummary() });
    render(<AnalyticsOverview />);

    await waitFor(() => expect(screen.getByText(/No requests yet/)).toBeInTheDocument());
    expect(screen.getByText(/\/v1\/chat\/completions/)).toBeInTheDocument();
  });

  it('renders headline metrics and the per-model breakdown when data is present', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => populatedSummary() });
    render(<AnalyticsOverview />);

    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
    expect(screen.getByText('$1.50')).toBeInTheDocument(); // Money Saved headline
    expect(screen.getByText('450 ms')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument(); // cache hit rate
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('claude-3-haiku')).toBeInTheDocument();
  });

  it('re-fetches with a new since parameter when the time range is changed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => populatedSummary() });
    global.fetch = fetchMock;
    render(<AnalyticsOverview />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain('/api/analytics?since=');

    fireEvent.click(screen.getByText('Last 7 days'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows an error message when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<AnalyticsOverview />);

    await waitFor(() => expect(screen.getByText(/Could not load analytics/)).toBeInTheDocument());
  });
});
