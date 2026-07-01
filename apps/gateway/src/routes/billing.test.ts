import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

describe('POST /v1/billing/subscribe', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('creates a Razorpay customer and subscription for a new workspace (admin member)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/subscribe',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { planId: 'plan_fixed', email: 'billing@acme.test', contact: '+919876543210' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.customerId).toBeDefined();
    expect(body.subscriptionId).toBeDefined();
    expect(body.status).toBe('active');
    expect(t.billing.customers).toHaveLength(1);
    expect(t.billing.customers[0]).toMatchObject({ workspaceId: t.workspaceId, email: 'billing@acme.test' });
  });

  it('persists billing fields on the workspace store', async () => {
    const t = buildTestApp();
    app = t.app;
    await t.app.inject({
      method: 'POST',
      url: '/v1/billing/subscribe',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { planId: 'plan_fixed', email: 'billing@acme.test' },
    });
    const ws = await t.stores.workspaces.get(t.workspaceId);
    expect(ws?.razorpayCustomerId).toBeDefined();
    expect(ws?.razorpaySubscriptionId).toBeDefined();
    expect(ws?.subscriptionStatus).toBe('active');
  });

  it('rejects a plain member role (403)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/subscribe',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
      payload: { planId: 'plan_fixed', email: 'billing@acme.test' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an invalid body', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/subscribe',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { planId: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/billing/cancel', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('cancels an active subscription', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    await t.app.inject({
      method: 'POST',
      url: '/v1/billing/subscribe',
      headers,
      payload: { planId: 'plan_fixed', email: 'billing@acme.test' },
    });
    const res = await t.app.inject({ method: 'POST', url: '/v1/billing/cancel', headers });
    expect(res.statusCode).toBe(200);
    const ws = await t.stores.workspaces.get(t.workspaceId);
    expect(ws?.subscriptionStatus).toBe('canceled');
  });

  it('returns 400 when there is no active subscription', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/cancel',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/billing/status', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports "none" status for a workspace with no subscription', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/billing/status',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId: null, subscriptionId: null, status: 'none' });
  });
});

describe('POST /v1/billing/webhook', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects a request with an invalid signature', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'x-razorpay-signature': 'invalid', 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a request missing the signature header', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies a subscription.pending event and updates the workspace status', async () => {
    const t = buildTestApp();
    app = t.app;
    t.billing.queueWebhookEvent({
      id: 'evt_1',
      type: 'subscription.pending',
      data: {
        subscription: {
          entity: { id: 'sub_1', status: 'pending', notes: { workspaceId: t.workspaceId } },
        },
      },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'x-razorpay-signature': 'valid-sig', 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'evt_1' }),
    });
    expect(res.statusCode).toBe(200);
    const ws = await t.stores.workspaces.get(t.workspaceId);
    expect(ws?.subscriptionStatus).toBe('past_due');
  });

  it('applies a subscription.activated event and sets status active', async () => {
    const t = buildTestApp();
    app = t.app;
    t.billing.queueWebhookEvent({
      id: 'evt_activated',
      type: 'subscription.activated',
      data: {
        subscription: {
          entity: { id: 'sub_1', status: 'active', notes: { workspaceId: t.workspaceId } },
        },
      },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'x-razorpay-signature': 'valid-sig', 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'evt_activated' }),
    });
    expect(res.statusCode).toBe(200);
    const ws = await t.stores.workspaces.get(t.workspaceId);
    expect(ws?.subscriptionStatus).toBe('active');
  });

  it('processes a duplicate event id idempotently (does not error, marked duplicate)', async () => {
    const t = buildTestApp();
    app = t.app;
    const event = {
      id: 'evt_dup',
      type: 'subscription.updated',
      data: {
        subscription: {
          entity: { id: 'sub_1', status: 'active', notes: { workspaceId: t.workspaceId } },
        },
      },
    };
    t.billing.queueWebhookEvent(event);
    t.billing.queueWebhookEvent(event);

    const first = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'x-razorpay-signature': 'valid-sig', 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'evt_dup' }),
    });
    const second = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'x-razorpay-signature': 'valid-sig', 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'evt_dup' }),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().duplicate).toBeUndefined();
    expect(second.statusCode).toBe(200);
    expect(second.json().duplicate).toBe(true);
  });
});
