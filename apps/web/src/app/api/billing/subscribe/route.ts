import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callGateway, GatewayApiError } from '@/lib/gateway';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { planId, email, name, contact, totalCount } = body;

  try {
    const data = await callGateway('/v1/billing/subscribe', {
      method: 'POST',
      workspaceId: session.activeWorkspaceId,
      memberId: session.activeMemberId,
      body: { planId, email, name, contact, totalCount },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}
