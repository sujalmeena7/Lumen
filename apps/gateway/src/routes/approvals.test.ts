import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

function enableApprovals(t: ReturnType<typeof buildTestApp>) {
  t.stores.addWorkspace({
    id: t.workspaceId,
    name: 'Test WS',
    routingWeights: null,
    requireApprovalForSensitiveActions: true,
  });
}

describe('approval workflow', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('a pending credential rotation appears in the approvals list', async () => {
    const t = buildTestApp();
    app = t.app;
    enableApprovals(t);

    await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-pending' },
    });

    const list = await t.app.inject({
      method: 'GET',
      url: '/v1/approvals?status=pending',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(list.statusCode).toBe(200);
    const approvals = list.json().approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0].actionType).toBe('credential_rotate');
    expect(approvals[0].status).toBe('pending');
  });

  it('approving a pending credential rotation applies it', async () => {
    const t = buildTestApp();
    app = t.app;
    enableApprovals(t);

    const createRes = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-to-approve' },
    });
    const { approvalId } = createRes.json();

    const reviewRes = await t.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/review`,
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.ownerId },
      payload: { action: 'approve' },
    });
    expect(reviewRes.statusCode).toBe(200);
    expect(reviewRes.json().approval.status).toBe('approved');

    const stored = await t.stores.credentials.getForProvider(t.workspaceId, 'openai');
    expect(stored).not.toBeNull();
    expect(t.vault.decrypt(stored!)).toBe('sk-to-approve');
  });

  it('rejecting a pending credential rotation discards it', async () => {
    const t = buildTestApp();
    app = t.app;
    enableApprovals(t);

    const createRes = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-to-reject' },
    });
    const { approvalId } = createRes.json();

    const reviewRes = await t.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/review`,
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.ownerId },
      payload: { action: 'reject' },
    });
    expect(reviewRes.statusCode).toBe(200);
    expect(reviewRes.json().approval.status).toBe('rejected');

    const stored = await t.stores.credentials.getForProvider(t.workspaceId, 'openai');
    expect(stored).toBeNull();
  });

  it('a plain member cannot review an approval (403)', async () => {
    const t = buildTestApp();
    app = t.app;
    enableApprovals(t);
    const createRes = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-x' },
    });
    const { approvalId } = createRes.json();

    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/review`,
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
      payload: { action: 'approve' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('reviewing an already-reviewed approval returns 409', async () => {
    const t = buildTestApp();
    app = t.app;
    enableApprovals(t);
    const createRes = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-x' },
    });
    const { approvalId } = createRes.json();
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.ownerId };
    await t.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/review`,
      headers,
      payload: { action: 'approve' },
    });
    const second = await t.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/review`,
      headers,
      payload: { action: 'reject' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('returns 404 reviewing an unknown approval id', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/approvals/does-not-exist/review',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.ownerId },
      payload: { action: 'approve' },
    });
    expect(res.statusCode).toBe(404);
  });
});
