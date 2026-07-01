import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

describe('POST /v1/auth/dev-login', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('creates a new user on first login and returns no memberships', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'new-user@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('new-user@example.com');
    expect(body.memberships).toEqual([]);
  });

  it('finds an existing user and returns their workspace memberships', async () => {
    const t = buildTestApp();
    app = t.app;
    t.stores.addUser('user_admin', 'admin@example.com');

    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'admin@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe('user_admin');
    expect(body.memberships).toEqual([
      {
        memberId: t.adminId,
        role: 'admin',
        workspace: { id: t.workspaceId, name: 'Test WS' },
      },
    ]);
  });

  it('is idempotent: logging in twice returns the same user id', async () => {
    const t = buildTestApp();
    app = t.app;
    const first = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'repeat@example.com' },
    });
    const second = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'repeat@example.com' },
    });
    expect(first.json().user.id).toBe(second.json().user.id);
  });

  it('rejects an invalid email', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing email', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not require gateway key authentication (public dev-login)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'no-auth-header@example.com' },
    });
    expect(res.statusCode).toBe(200);
  });
});
