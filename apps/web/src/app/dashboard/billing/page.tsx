import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import BillingAndCaps from '@/components/BillingAndCaps';

export default async function BillingPage() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    redirect('/login');
  }

  const isAdmin = session.activeRole === 'admin' || session.activeRole === 'owner';

  return <BillingAndCaps isAdmin={isAdmin} />;
}
