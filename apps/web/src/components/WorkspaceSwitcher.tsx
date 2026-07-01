'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

interface Workspace {
  workspace: { id: string; name: string };
  role: string;
}

export default function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.workspaces) {
          setWorkspaces(data.workspaces);
          setActiveId(data.activeWorkspaceId);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSwitch = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setActiveId(newId);
    await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: newId }),
    });
    router.refresh();
  };

  if (loading) {
    return <div className="h-10 bg-white/5 rounded-lg animate-pulse w-full"></div>;
  }

  return (
    <div className="relative">
      <select
        value={activeId}
        onChange={handleSwitch}
        className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-medium text-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
      >
        {workspaces.map((w) => (
          <option key={w.workspace.id} value={w.workspace.id} className="bg-navy-800">
            {w.workspace.name} ({w.role})
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
        <ChevronDown size={14} className="text-slate-400" />
      </div>
    </div>
  );
}
