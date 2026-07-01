import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callGateway, GatewayApiError } from '@/lib/gateway';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since');
  const until = searchParams.get('until');
  const qs = new URLSearchParams();
  if (since) qs.set('since', since);
  if (until) qs.set('until', until);
  const path = `/v1/analytics/summary${qs.toString() ? `?${qs.toString()}` : ''}`;

  try {
    const data = await callGateway(path, { workspaceId: session.activeWorkspaceId });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GatewayApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }
}
