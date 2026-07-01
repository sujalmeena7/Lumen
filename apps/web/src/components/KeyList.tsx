'use client';

import { useState } from 'react';
import { Key as KeyIcon, Trash2, Clock } from 'lucide-react';
import KeyCreateDialog from './KeyCreateDialog';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function KeyList({ keys, isAdmin }: { keys: { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[]; isAdmin: boolean }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const router = useRouter();

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke the key "${name}"? Any applications using it will immediately lose access.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to revoke key');
      }
    } catch {
      alert('Error revoking key');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString(undefined, { 
      year: 'numeric', month: 'short', day: 'numeric' 
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <KeyIcon size={20} className="text-blue-400" />
            Gateway API Keys
          </h2>
          <p className="text-slate-400 text-sm mt-1">Manage API keys used to authenticate with your router gateway.</p>
        </div>
        
        {isAdmin && (
          <button onClick={() => setIsDialogOpen(true)} className="btn-primary flex items-center gap-2">
            <span>+</span> Create Key
          </button>
        )}
      </div>

      <motion.div 
        className="glass-panel overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-black/20 text-slate-300 border-b border-white/10">
            <tr>
              <th className="px-6 py-4 font-medium">NAME</th>
              <th className="px-6 py-4 font-medium">KEY PREFIX</th>
              <th className="px-6 py-4 font-medium">CREATED</th>
              <th className="px-6 py-4 font-medium">LAST USED</th>
              <th className="px-6 py-4 font-medium">STATUS</th>
              {isAdmin && <th className="px-6 py-4 text-right font-medium">ACTIONS</th>}
            </tr>
          </thead>
          <motion.tbody 
            className="divide-y divide-white/5"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05 } }
            }}
          >
            {keys.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-6 py-8 text-center text-slate-500">
                  No gateway keys found.
                </td>
              </tr>
            ) : keys.map((key) => (
              <motion.tr 
                key={key.id} 
                className="hover:bg-white/[0.04] transition-colors group"
                variants={{
                  hidden: { opacity: 0, x: -10 },
                  visible: { opacity: 1, x: 0 }
                }}
              >
                <td className="px-6 py-4 font-medium text-slate-200 group-hover:text-white transition-colors">{key.name}</td>
                <td className="px-6 py-4 font-mono text-slate-400">{key.keyPrefix}...</td>
                <td className="px-6 py-4 text-slate-400">{formatDate(key.createdAt)}</td>
                <td className="px-6 py-4 text-slate-400">
                  <div className="flex items-center gap-1.5">
                    {key.lastUsedAt && <Clock size={14} className="text-slate-500" />}
                    {formatDate(key.lastUsedAt)}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {key.revokedAt ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                      Revoked
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                      Active
                    </span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 text-right">
                    {!key.revokedAt && (
                      <button 
                        onClick={() => handleRevoke(key.id, key.name)}
                        className="text-slate-400 hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition-all hover:scale-110 active:scale-95"
                        title="Revoke key"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                )}
              </motion.tr>
            ))}
          </motion.tbody>
        </table>
      </motion.div>

      <KeyCreateDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
    </div>
  );
}
