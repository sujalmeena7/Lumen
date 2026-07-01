import CredentialList from '@/components/CredentialList';
import { getSession } from '@/lib/session';
import { callGateway } from '@/lib/gateway';
import { redirect } from 'next/navigation';

interface Credential {
  provider: string;
  label: string | null;
  createdAt: string;
  rotatedAt: string | null;
}

export default async function CredentialsPage() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    redirect('/login');
  }

  const data = await callGateway<{ credentials: Credential[] }>('/v1/credentials', {
    workspaceId: session.activeWorkspaceId,
  });

  const isAdmin = session.activeRole === 'admin' || session.activeRole === 'owner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
          Provider Credentials
        </h1>
        <p className="text-slate-400 mt-2">Manage the underlying AI provider keys.</p>
      </div>

      <CredentialList credentials={data.credentials} isAdmin={isAdmin} />
    </div>
  );
}
