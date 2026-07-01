import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

describe('POST /v1/keys', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('creates a gateway key and returns the plaintext exactly once (admin member)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { name: 'CI Key' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('CI Key');
    expect(typeof body.plaintext).toBe('string');
    expect(body.plaintext.startsWith('sk-rtr-')).toBe(true);
    expect(body.keyPrefix).toBe(body.plaintext.slice(0, 12));
  });

  it('the created key can immediately authenticate against the gateway', async () => {
    const t = buildTestApp();
    app = t.app;
    const create = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: { name: 'CI Key' },
    });
    const { plaintext } = create.json();

    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a plain member role (403)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
      payload: { name: 'Should Fail' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects without an X-Member-Id header (401)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}` },
      payload: { name: 'Should Fail' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing name', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({ method: 'POST', url: '/v1/keys', payload: { name: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/keys', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lists metadata only for the workspace (never plaintext or hash)', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    const create = await t.app.inject({ method: 'POST', url: '/v1/keys', headers, payload: { name: 'K1' } });
    const { plaintext } = create.json();

    const res = await t.app.inject({ method: 'GET', url: '/v1/keys', headers: { authorization: `Bearer ${t.apiKey}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys.some((k: { name: string }) => k.name === 'K1')).toBe(true);
    expect(JSON.stringify(body)).not.toContain(plaintext);
  });

  it('does not require member identity to list (read-only)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /v1/keys/:id', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('revokes an existing key (admin member) and it can no longer authenticate', async () => {
    const t = buildTestApp();
    app = t.app;
    const headers = { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId };
    const create = await t.app.inject({ method: 'POST', url: '/v1/keys', headers, payload: { name: 'ToRevoke' } });
    const { id, plaintext } = create.json();

    const del = await t.app.inject({ method: 'DELETE', url: `/v1/keys/${id}`, headers });
    expect(del.statusCode).toBe(204);

    const useRevoked = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(useRevoked.statusCode).toBe(401);
  });

  it('rejects a plain member role (403)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/v1/keys/some-id',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.memberId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a key that does not exist', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/v1/keys/does-not-exist',
      headers: { authorization: `Bearer ${t.apiKey}`, 'x-member-id': t.adminId },
    });
    expect(res.statusCode).toBe(404);
  });
});
