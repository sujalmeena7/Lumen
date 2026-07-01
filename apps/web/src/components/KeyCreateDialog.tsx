'use client';

import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import CopyButton from './CopyButton';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

export default function KeyCreateDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ plaintext: string; keyPrefix: string } | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        router.refresh(); // Refresh background list
      } else if (res.status === 202) {
        const data = await res.json();
        alert(data.status === 'pending_approval' ? 'Request submitted for admin approval.' : 'Submitted.');
        handleClose();
      } else {
        alert('Failed to create key');
      }
    } catch {
      alert('Error creating key');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setResult(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div 
            className="glass-panel w-full max-w-lg p-8 relative"
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={20} />
        </button>

        {!result ? (
          <>
            <h2 className="text-xl font-semibold mb-4 text-white">Create Gateway Key</h2>
            <p className="text-slate-400 mb-6 text-sm">
              This key allows your applications to authenticate with the Lumen Gateway.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Key Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="glass-input w-full"
                  placeholder="e.g. Production Application"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
                <button type="button" onClick={handleClose} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !name} className="btn-primary">
                  {loading ? 'Creating...' : 'Create Key'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold mb-4 text-white">Key Created Successfully</h2>
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 flex gap-3 text-amber-200/90 items-start">
              <AlertTriangle size={20} className="shrink-0 mt-0.5 text-amber-400" />
              <p className="text-sm">
                Please copy this key and save it somewhere safe. For security reasons, <strong>we will never show it to you again.</strong>
              </p>
            </div>

            <div className="bg-black/30 border border-white/10 rounded-lg p-3 flex items-center justify-between mb-8 group relative overflow-hidden">
              <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <code className="text-blue-300 font-mono break-all pr-4 relative z-10">
                {result.plaintext}
              </code>
              <CopyButton text={result.plaintext} className="relative z-10 bg-white/5" />
            </div>

            <div className="flex justify-end">
              <button onClick={handleClose} className="btn-primary">
                I&apos;ve saved this key
              </button>
            </div>
          </>
        )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
