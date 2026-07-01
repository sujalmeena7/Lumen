import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:8080';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.userId || !session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { workspaceId } = await request.json().catch(() => ({}));
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
  }

  // Re-resolve memberships so we can look up the memberId/role for the
  // requested workspace (and make sure the user actually belongs to it).
  const res = await fetch(`${GATEWAY_URL}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: session.email }),
    cache: 'no-store',
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to resolve memberships' }, { status: 502 });
  }
  const data = await res.json();
  const membership = data.memberships.find(
    (m: { workspace: { id: string } }) => m.workspace.id === workspaceId,
  );
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of that workspace' }, { status: 403 });
  }

  session.activeWorkspaceId = membership.workspace.id;
  session.activeMemberId = membership.memberId;
  session.activeRole = membership.role;
  await session.save();

  return NextResponse.json({ success: true, activeWorkspaceId: session.activeWorkspaceId });
}
