'use client';

import { useState } from 'react';
import { Shield, Trash2, Clock, Plus } from 'lucide-react';
import CredentialForm from './CredentialForm';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

export default function CredentialList({ credentials, isAdmin }: { credentials: { provider: string; label: string | null; createdAt: string; rotatedAt: string | null }[]; isAdmin: boolean }) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const router = useRouter();

  const handleDelete = async (provider: string) => {
    if (!confirm(`Are you sure you want to remove the ${provider} credential? Routing to this provider will fail.`)) {
      return;
    }

    try {
      const res = await fetch('/api/credentials', { 
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to delete credential');
      }
    } catch {
      alert('Error deleting credential');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Shield size={20} className="text-blue-400" />
            Provider Credentials
          </h2>
          <p className="text-slate-400 text-sm mt-1">Manage upstream API keys (OpenAI, Anthropic, Groq).</p>
        </div>
        
        {isAdmin && !isFormOpen && (
          <button onClick={() => setIsFormOpen(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add Credential
          </button>
        )}
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            className="glass-panel p-6 mb-8 overflow-hidden"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3 }}
          >
            <h3 className="text-lg font-medium text-white mb-4">Add or Update Credential</h3>
            <CredentialForm onClose={() => setIsFormOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        className="glass-panel overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-black/20 text-slate-300 border-b border-white/10">
            <tr>
              <th className="px-6 py-4 font-medium">PROVIDER</th>
              <th className="px-6 py-4 font-medium">LABEL</th>
              <th className="px-6 py-4 font-medium">ADDED</th>
              <th className="px-6 py-4 font-medium">LAST ROTATED</th>
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
            {credentials.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="px-6 py-8 text-center text-slate-500">
                  No provider credentials configured.
                </td>
              </tr>
            ) : credentials.map((cred) => (
              <motion.tr 
                key={cred.provider} 
                className="hover:bg-white/[0.04] transition-colors group"
                variants={{
                  hidden: { opacity: 0, x: -10 },
                  visible: { opacity: 1, x: 0 }
                }}
              >
                <td className="px-6 py-4 font-medium text-slate-200 capitalize group-hover:text-white transition-colors">
                  {cred.provider}
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {cred.label || <span className="text-slate-600 italic">No label</span>}
                </td>
                <td className="px-6 py-4 text-slate-400">{formatDate(cred.createdAt)}</td>
                <td className="px-6 py-4 text-slate-400">
                  <div className="flex items-center gap-1.5">
                    {cred.rotatedAt && <Clock size={14} className="text-slate-500" />}
                    {formatDate(cred.rotatedAt)}
                  </div>
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => handleDelete(cred.provider)}
                      className="text-slate-400 hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition-all hover:scale-110 active:scale-95"
                      title="Delete credential"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </motion.tr>
            ))}
          </motion.tbody>
        </table>
      </motion.div>
    </div>
  );
}
