import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

describe('POST /v1/credentials', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('stores an encrypted credential and never echoes the plaintext key back (admin member)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-super-secret-value', label: 'prod key' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ provider: 'openai', label: 'prod key', status: 'stored' });
    expect(JSON.stringify(body)).not.toContain('sk-super-secret-value');

    const stored = await t.stores.credentials.getForProvider(t.workspaceId, 'openai');
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain('sk-super-secret-value');
    expect(t.vault.decrypt(stored!)).toBe('sk-super-secret-value');
  });

  it('rejects without an X-Member-Id header (401)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { provider: 'openai', apiKey: 'sk-x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a plain member role (403) - requires admin or higher', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
      payload: { provider: 'openai', apiKey: 'sk-x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows an owner (role above admin) to store a credential', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.ownerId },
      payload: { provider: 'groq', apiKey: 'gsk-owner-key' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects an invalid provider', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'not-a-provider', apiKey: 'sk-x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing apiKey', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      payload: { provider: 'openai', apiKey: 'sk-x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rotating a credential re-encrypts and replaces the stored value', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers,
      payload: { provider: 'openai', apiKey: 'sk-original' },
    });
    await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers,
      payload: { provider: 'openai', apiKey: 'sk-rotated' },
    });
    const stored = await t.stores.credentials.getForProvider(t.workspaceId, 'openai');
    expect(t.vault.decrypt(stored!)).toBe('sk-rotated');
  });

  it('queues the rotation for approval when the workspace requires it, instead of applying immediately', async () => {
    const t = buildTestApp();
    app = t.app;
    t.stores.addWorkspace({
      id: t.workspaceId,
      name: 'Test WS',
      routingWeights: null,
      requireApprovalForSensitiveActions: true,
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { provider: 'openai', apiKey: 'sk-should-be-pending' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('pending_approval');
    // Not applied yet.
    const stored = await t.stores.credentials.getForProvider(t.workspaceId, 'openai');
    expect(stored).toBeNull();
  });
});

describe('GET /v1/credentials', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lists metadata only (no ciphertext/secrets) for the workspace', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers,
      payload: { provider: 'anthropic', apiKey: 'sk-ant-secret', label: 'anthropic key' },
    });

    // Listing itself doesn't require a member identity (read-only, not sensitive).
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credentials).toHaveLength(1);
    expect(body.credentials[0]).toMatchObject({ provider: 'anthropic', label: 'anthropic key' });
    expect(JSON.stringify(body)).not.toContain('sk-ant-secret');
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|encryptedDek|authTag/);
  });

  it('returns an empty list when no credentials exist', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/credentials',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().credentials).toEqual([]);
  });
});

describe('DELETE /v1/credentials/:provider', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('deletes an existing credential (admin member)', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    await t.app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers,
      payload: { provider: 'groq', apiKey: 'gsk-secret' },
    });

    const del = await t.app.inject({ method: 'DELETE', url: '/v1/credentials/groq', headers });
    expect(del.statusCode).toBe(204);

    const stored = await t.stores.credentials.getForProvider(t.workspaceId, 'groq');
    expect(stored).toBeNull();
  });

  it('rejects a plain member role (403)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/v1/credentials/groq',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when deleting a credential that does not exist', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/v1/credentials/groq',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid provider path param', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/v1/credentials/not-a-provider',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
    });
    expect(res.statusCode).toBe(400);
  });
});
