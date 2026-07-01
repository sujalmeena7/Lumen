import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callGateway, GatewayApiError } from '@/lib/gateway';

export async function GET() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await callGateway('/v1/spending-caps', { workspaceId: session.activeWorkspaceId });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { memberId, monthlyLimitUsd } = body;

  try {
    const data = await callGateway('/v1/spending-caps', {
      method: 'POST',
      workspaceId: session.activeWorkspaceId,
      memberId: session.activeMemberId,
      body: { memberId: memberId ?? null, monthlyLimitUsd },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}
