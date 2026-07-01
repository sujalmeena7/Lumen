import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import Sidebar from '@/components/Sidebar';
import PageTransition from '@/components/PageTransition';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session.userId) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen bg-transparent overflow-hidden">
      <Sidebar />
      <div className="flex-1 overflow-y-auto relative">
        <div className="absolute inset-0 p-8 max-w-7xl mx-auto">
          <PageTransition>{children}</PageTransition>
        </div>
      </div>
    </div>
  );
}
