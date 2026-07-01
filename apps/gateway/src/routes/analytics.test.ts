import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';
import type { RequestLogInput } from '../stores/types.js';

function logInput(overrides: Partial<RequestLogInput> = {}): RequestLogInput {
  return {
    workspaceId: 'ws_test_1',
    traceId: 'trace-1',
    requestedModel: 'auto',
    chosenModel: 'gpt-4o-mini',
    provider: 'openai',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costUsd: 0.01,
    baselineCostUsd: 0.05,
    savedUsd: 0.04,
    latencyMs: 400,
    cacheHit: false,
    fallbackUsed: false,
    complexityScore: 0.2,
    status: 'success',
    ...overrides,
  };
}

describe('GET /v1/analytics/summary', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns a well-formed empty state when there are no requests yet', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/analytics/summary',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalRequests).toBe(0);
    expect(body.totalSavedUsd).toBe(0);
    expect(body.cacheHitRate).toBe(0);
    expect(body.byModel).toEqual([]);
    expect(body.range.since).toBeDefined();
    expect(body.range.until).toBeDefined();
  });

  it('aggregates totals, Money Saved, and per-model breakdown for seeded requests', async () => {
    const t = buildTestApp();
    app = t.app;
    await t.stores.requestLogs.create(logInput({ workspaceId: t.workspaceId, chosenModel: 'gpt-4o-mini', costUsd: 0.01, baselineCostUsd: 0.05, savedUsd: 0.04 }));
    await t.stores.requestLogs.create(logInput({ workspaceId: t.workspaceId, chosenModel: 'gpt-4o-mini', costUsd: 0.01, baselineCostUsd: 0.05, savedUsd: 0.04 }));
    await t.stores.requestLogs.create(logInput({ workspaceId: t.workspaceId, chosenModel: 'claude-3-haiku', provider: 'anthropic', costUsd: 0.02, baselineCostUsd: 0.06, savedUsd: 0.04 }));

    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/analytics/summary',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalRequests).toBe(3);
    expect(body.totalCostUsd).toBeCloseTo(0.04, 5);
    expect(body.totalSavedUsd).toBeCloseTo(0.12, 5);
    expect(body.byModel).toHaveLength(2);
    expect(body.byModel[0]).toMatchObject({ model: 'gpt-4o-mini', requests: 2 });
  });

  it('only includes requests for the authenticated workspace (no cross-tenant leakage)', async () => {
    const t = buildTestApp();
    app = t.app;
    await t.stores.requestLogs.create(logInput({ workspaceId: t.workspaceId }));
    await t.stores.requestLogs.create(logInput({ workspaceId: 'some-other-workspace' }));

    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/analytics/summary',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.json().totalRequests).toBe(1);
  });

  it('respects an explicit since/until range, excluding requests outside it', async () => {
    const t = buildTestApp();
    app = t.app;
    // Directly push a record with a controlled createdAt (bypassing create(), which stamps "now").
    t.stores.logs.push({ ...logInput({ workspaceId: t.workspaceId }), createdAt: new Date('2020-01-01T00:00:00Z') });
    await t.stores.requestLogs.create(logInput({ workspaceId: t.workspaceId }));

    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?since=2024-01-01T00:00:00Z&until=2030-01-01T00:00:00Z`,
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.json().totalRequests).toBe(1);
  });

  it('rejects an invalid date query param', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/analytics/summary?since=not-a-date',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects since being after until', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/analytics/summary?since=2025-01-01T00:00:00Z&until=2024-01-01T00:00:00Z',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({ method: 'GET', url: '/v1/analytics/summary' });
    expect(res.statusCode).toBe(401);
  });

  it('does not require a member identity (read-only, like traces)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/analytics/summary',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
