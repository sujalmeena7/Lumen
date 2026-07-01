import KeyList from '@/components/KeyList';
import { getSession } from '@/lib/session';
import { callGateway } from '@/lib/gateway';
import { redirect } from 'next/navigation';

interface GatewayKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default async function KeysPage() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    redirect('/login');
  }

  const data = await callGateway<{ keys: GatewayKey[] }>('/v1/keys', {
    workspaceId: session.activeWorkspaceId,
  });

  const isAdmin = session.activeRole === 'admin' || session.activeRole === 'owner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
          API Keys
        </h1>
        <p className="text-slate-400 mt-2">Manage gateway access keys for your workspace.</p>
      </div>

      <KeyList keys={data.keys} isAdmin={isAdmin} />
    </div>
  );
}
