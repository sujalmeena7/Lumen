import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';
import { monthlySpendKey } from '../spending/tracker.js';
import type { FetchLike, FetchLikeResponse } from '../adapters/types.js';

function seedOpenAiCredential(t: ReturnType<typeof buildTestApp>) {
  const secret = t.vault.encrypt('sk-openai-fake-key');
  t.stores.addCredential(t.workspaceId, 'openai', { provider: 'openai', ...secret });
}

function jsonResponse(body: unknown): FetchLikeResponse {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), body: null };
}

describe('POST /v1/spending-caps', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('sets a workspace-wide cap (admin member)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { monthlyLimitUsd: 1500 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cap).toMatchObject({ workspaceId: t.workspaceId, memberId: null, monthlyLimitUsd: 1500 });
  });

  it('sets a per-member cap', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { memberId: t.memberId, monthlyLimitUsd: 50 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cap).toMatchObject({ memberId: t.memberId, monthlyLimitUsd: 50 });
  });

  it('rejects a plain member role (403)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
      payload: { monthlyLimitUsd: 1500 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a non-positive limit', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { monthlyLimitUsd: -5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/spending-caps and DELETE', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lists configured caps', async () => {
    const t = buildTestApp();
    app = t.app;
    await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { monthlyLimitUsd: 1500 },
    });
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().caps).toHaveLength(1);
  });

  it('includes the current-month running spend alongside each cap', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    await t.app.inject({ method: 'POST', url: '/v1/spending-caps', headers, payload: { monthlyLimitUsd: 100 } });
    await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers,
      payload: { memberId: t.memberId, monthlyLimitUsd: 20 },
    });

    await t.spendingTracker.addSpend(monthlySpendKey(t.workspaceId, null), 12.5);
    await t.spendingTracker.addSpend(monthlySpendKey(t.workspaceId, t.memberId), 3.25);

    const res = await t.app.inject({ method: 'GET', url: '/v1/spending-caps', headers: { authorization: `Bearer ${t.apiKey}` } });
    const caps = res.json().caps;
    const workspaceCap = caps.find((c: { memberId: string | null }) => c.memberId === null);
    const memberCap = caps.find((c: { memberId: string | null }) => c.memberId === t.memberId);
    expect(workspaceCap.currentSpendUsd).toBeCloseTo(12.5, 5);
    expect(memberCap.currentSpendUsd).toBeCloseTo(3.25, 5);
  });

  it('reports 0 current spend for a newly created cap', async () => {
    const t = buildTestApp();
    app = t.app;
    await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { monthlyLimitUsd: 1500 },
    });
    const res = await t.app.inject({ method: 'GET', url: '/v1/spending-caps', headers: { authorization: `Bearer ${t.apiKey}` } });
    expect(res.json().caps[0].currentSpendUsd).toBe(0);
  });

  it('deletes the workspace-wide cap', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    await t.app.inject({ method: 'POST', url: '/v1/spending-caps', headers, payload: { monthlyLimitUsd: 1500 } });
    const del = await t.app.inject({ method: 'DELETE', url: '/v1/spending-caps/workspace', headers });
    expect(del.statusCode).toBe(204);
    const list = await t.app.inject({ method: 'GET', url: '/v1/spending-caps', headers });
    expect(list.json().caps).toHaveLength(0);
  });

  it('returns 404 deleting a cap that does not exist', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/v1/spending-caps/workspace',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('spending cap enforcement on /v1/chat/completions', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('blocks requests once the workspace cap is exceeded, with a clear error', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        // Large usage so cost quickly exceeds a small cap.
        usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
      });
    };
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);

    // gpt-4o-mini: 0.15/M input + 0.6/M output => 1M*0.15/1e6 + 1M*0.6/1e6 = 0.75 per call.
    await t.app.inject({
      method: 'POST',
      url: '/v1/spending-caps',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { monthlyLimitUsd: 0.5 }, // lower than a single call's cost
    });

    const payload = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };
    const headers = { authorization: `Bearer ${t.apiKey}` };

    const first = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    expect(first.statusCode).toBe(200); // allowed: spend starts at 0, under the cap

    const second = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('spending_cap_exceeded');
    expect(second.json().error.message).toContain('Spending cap exceeded');

    // Only the first (allowed) call actually reached the provider.
    expect(calls).toBe(1);

    // Verify a blocked request was logged with status "blocked".
    const blockedLog = t.stores.logs.find((l) => l.status === 'blocked');
    expect(blockedLog).toBeDefined();
  });

  it('does not block requests when no cap is configured', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const t = buildTestApp({ fetchFn });
    app = t.app;
    seedOpenAiCredential(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
  });
});
