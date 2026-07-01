import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callGateway, GatewayApiError } from '@/lib/gateway';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await callGateway(`/v1/keys/${id}`, {
      method: 'DELETE',
      workspaceId: session.activeWorkspaceId,
      memberId: session.activeMemberId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}
