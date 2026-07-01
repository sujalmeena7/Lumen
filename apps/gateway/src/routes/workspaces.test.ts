import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp } from '../test-utils/testApp.js';

describe('GET /v1/workspaces/members', () => {
  let app: ReturnType<typeof buildTestApp>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lists every member of the workspace with their email and role', async () => {
    const t = buildTestApp();
    app = t.app;
    t.stores.addUser('user_owner', 'owner@example.com');
    t.stores.addUser('user_admin', 'admin@example.com');
    t.stores.addUser('user_member', 'member@example.com');

    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/workspaces/members',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    const members = res.json().members;
    expect(members).toHaveLength(3);
    expect(members).toContainEqual({ memberId: t.ownerId, email: 'owner@example.com', role: 'owner' });
    expect(members).toContainEqual({ memberId: t.adminId, email: 'admin@example.com', role: 'admin' });
    expect(members).toContainEqual({ memberId: t.memberId, email: 'member@example.com', role: 'member' });
  });

  it('only lists members of the authenticated workspace', async () => {
    const t = buildTestApp();
    app = t.app;
    t.stores.addMember('other-workspace', 'member_other', 'user_other', 'admin');

    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/workspaces/members',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    const members = res.json().members;
    expect(members.every((m: { memberId: string }) => m.memberId !== 'member_other')).toBe(true);
  });

  it('does not require a member identity (read-only)', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/workspaces/members',
      headers: { authorization: `Bearer ${t.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('requires authentication', async () => {
    const t = buildTestApp();
    app = t.app;
    const res = await t.app.inject({ method: 'GET', url: '/v1/workspaces/members' });
    expect(res.statusCode).toBe(401);
  });
});
