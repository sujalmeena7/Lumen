import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callGateway, GatewayApiError } from '@/lib/gateway';

export async function POST() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await callGateway('/v1/billing/cancel', {
      method: 'POST',
      workspaceId: session.activeWorkspaceId,
      memberId: session.activeMemberId,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}
