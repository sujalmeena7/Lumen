import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callGateway, callGatewayRaw, GatewayApiError } from '@/lib/gateway';

export async function GET() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await callGateway('/v1/credentials', { workspaceId: session.activeWorkspaceId });
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
  const { provider, apiKey, label } = body;

  try {
    const { status, body: respBody } = await callGatewayRaw('/v1/credentials', {
      method: 'POST',
      workspaceId: session.activeWorkspaceId,
      memberId: session.activeMemberId,
      body: { provider, apiKey, label },
    });
    return NextResponse.json(respBody, { status });
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { provider } = body;

  try {
    await callGateway(`/v1/credentials/${provider}`, {
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
