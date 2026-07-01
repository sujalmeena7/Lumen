import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, TEST_INTERNAL_SERVICE_TOKEN } from '../test-utils/testApp.js';

describe('internal service token auth (dashboard BFF)', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('authenticates as the workspace named by X-Workspace-Id when the token matches', async () => {
    const t = buildTestApp({ withInternalServiceToken: true });
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: {
        authorization: `Bearer ${TEST_INTERNAL_SERVICE_TOKEN}`,
        'x-workspace-id': t.workspaceId,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('carries X-Member-Id through for RBAC exactly like gateway-key auth', async () => {
    const t = buildTestApp({ withInternalServiceToken: true });
    app = t.app;
    const asMember = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: {
        authorization: `Bearer ${TEST_INTERNAL_SERVICE_TOKEN}`,
        'x-workspace-id': t.workspaceId,
        'x-member-id': t.memberId,
      },
      payload: { name: 'x' },
    });
    expect(asMember.statusCode).toBe(403);

    const asAdmin = await t.app.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: {
        authorization: `Bearer ${TEST_INTERNAL_SERVICE_TOKEN}`,
        'x-workspace-id': t.workspaceId,
        'x-member-id': t.adminId,
      },
      payload: { name: 'x' },
    });
    expect(asAdmin.statusCode).toBe(201);
  });

  it('rejects a mismatched token, falling through to normal gateway-key lookup (401)', async () => {
    const t = buildTestApp({ withInternalServiceToken: true });
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: {
        authorization: 'Bearer not-the-real-token',
        'x-workspace-id': t.workspaceId,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('requires X-Workspace-Id when using the service token', async () => {
    const t = buildTestApp({ withInternalServiceToken: true });
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${TEST_INTERNAL_SERVICE_TOKEN}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown workspace id', async () => {
    const t = buildTestApp({ withInternalServiceToken: true });
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: {
        authorization: `Bearer ${TEST_INTERNAL_SERVICE_TOKEN}`,
        'x-workspace-id': 'does-not-exist',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is not accepted at all when no internal service token is configured', async () => {
    const t = buildTestApp({ withInternalServiceToken: false });
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: {
        authorization: `Bearer ${TEST_INTERNAL_SERVICE_TOKEN}`,
        'x-workspace-id': t.workspaceId,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('normal gateway-key auth still works unaffected when the token feature is enabled', async () => {
    const t = buildTestApp({ withInternalServiceToken: true });
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
