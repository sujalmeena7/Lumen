import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import AnalyticsOverview from '@/components/AnalyticsOverview';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session.userId || !session.activeWorkspaceId) {
    redirect('/login');
  }

  return <AnalyticsOverview />;
}
