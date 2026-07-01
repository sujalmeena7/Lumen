import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:8080';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Dev-grade auth: the gateway finds-or-creates the User and returns
    // their workspace memberships. See apps/gateway/src/routes/auth.ts.
    const res = await fetch(`${GATEWAY_URL}/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: body?.error?.message ?? 'Login failed' },
        { status: res.status },
      );
    }

    const data = await res.json();
    const session = await getSession();
    session.userId = data.user.id;
    session.email = data.user.email;

    const firstMembership = data.memberships[0];
    if (firstMembership) {
      session.activeWorkspaceId = firstMembership.workspace.id;
      session.activeMemberId = firstMembership.memberId;
      session.activeRole = firstMembership.role;
    }
    await session.save();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
