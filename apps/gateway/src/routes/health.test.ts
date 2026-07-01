import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

describe('GET /health', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 and ok status when dependencies are healthy', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies).toEqual({ postgres: 'ok', redis: 'ok' });
  });
});
