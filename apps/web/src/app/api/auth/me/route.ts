import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:8080';

export async function GET() {
  const session = await getSession();
  if (!session.userId || !session.email) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Re-resolve memberships from the gateway (source of truth). dev-login is
  // idempotent for an existing user, so this is safe to call on every load.
  const res = await fetch(`${GATEWAY_URL}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: session.email }),
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const data = await res.json();

  return NextResponse.json({
    user: data.user,
    activeWorkspaceId: session.activeWorkspaceId,
    workspaces: data.memberships.map((m: { memberId: string; role: string; workspace: { id: string; name: string } }) => ({
      workspace: m.workspace,
      role: m.role,
      memberId: m.memberId,
    })),
  });
}
