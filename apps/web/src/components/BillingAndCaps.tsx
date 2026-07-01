'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Gauge, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface SpendingCap {
  id: string;
  workspaceId: string;
  memberId: string | null;
  monthlyLimitUsd: number;
  currentSpendUsd: number;
}

interface WorkspaceMember {
  memberId: string;
  email: string;
  role: string;
}

interface BillingStatus {
  customerId: string | null;
  subscriptionId: string | null;
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
}

function formatUsd(n: number): string {
  if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const STATUS_STYLES: Record<BillingStatus['status'], string> = {
  none: 'bg-white/10 text-slate-300 border-white/20',
  trialing: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  past_due: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  canceled: 'bg-red-500/10 text-red-400 border-red-500/30',
  incomplete: 'bg-white/10 text-slate-300 border-white/20',
};

export default function BillingAndCaps({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [caps, setCaps] = useState<SpendingCap[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [capForm, setCapForm] = useState({ scope: 'workspace', memberId: '', monthlyLimitUsd: '' });
  const [capSubmitting, setCapSubmitting] = useState(false);

  const [subscribeForm, setSubscribeForm] = useState({ planId: '', email: '', name: '' });
  const [subscribing, setSubscribing] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [capsRes, membersRes, billingRes] = await Promise.all([
        fetch('/api/spending-caps'),
        fetch('/api/workspaces/members'),
        fetch('/api/billing/status'),
      ]);
      if (!capsRes.ok || !membersRes.ok || !billingRes.ok) throw new Error('failed');
      const capsData = await capsRes.json();
      const membersData = await membersRes.json();
      const billingData = await billingRes.json();
      setCaps(capsData.caps);
      setMembers(membersData.members);
      setBilling(billingData);
    } catch {
      setError('Could not load billing/spending-cap data. Try again shortly.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleSetCap = async (e: React.FormEvent) => {
    e.preventDefault();
    setCapSubmitting(true);
    try {
      const res = await fetch('/api/spending-caps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: capForm.scope === 'member' ? capForm.memberId : null,
          monthlyLimitUsd: Number(capForm.monthlyLimitUsd),
        }),
      });
      if (res.ok) {
        setCapForm({ scope: 'workspace', memberId: '', monthlyLimitUsd: '' });
        await load();
        router.refresh();
      } else {
        alert('Failed to set spending cap');
      }
    } finally {
      setCapSubmitting(false);
    }
  };

  const handleRemoveCap = async (memberId: string | null) => {
    if (!confirm('Remove this spending cap?')) return;
    const segment = memberId ?? 'workspace';
    const res = await fetch(`/api/spending-caps/${segment}`, { method: 'DELETE' });
    if (res.ok) {
      await load();
    } else {
      alert('Failed to remove spending cap');
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubscribing(true);
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscribeForm),
      });
      if (res.ok) {
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error?.message ?? 'Failed to subscribe');
      }
    } finally {
      setSubscribing(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Cancel the workspace subscription?')) return;
    setCanceling(true);
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      if (res.ok) {
        await load();
      } else {
        alert('Failed to cancel subscription');
      }
    } finally {
      setCanceling(false);
    }
  };

  const memberEmail = (memberId: string | null) =>
    memberId ? members.find((m) => m.memberId === memberId)?.email ?? memberId : 'Entire workspace';

  return (
    <motion.div 
      className="space-y-6"
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.15 } }
      }}
    >
      <motion.div variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0 } }}>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
          Billing &amp; Spending Caps
        </h1>
        <p className="text-slate-400 mt-2">Manage your subscription and enforce monthly spend limits.</p>
      </motion.div>

      {error && <div className="glass-panel p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">{error}</div>}

      {/* ---- Billing subscription ---- */}
      <motion.div 
        className="glass-panel p-6"
        variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0 } }}
      >
        <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
          <CreditCard size={20} className="text-blue-400" />
          Subscription
        </h2>

        {loading && !billing ? (
          <div className="h-16 bg-white/5 rounded-lg animate-pulse" />
        ) : billing ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_STYLES[billing.status]}`}
              >
                {billing.status}
              </span>
              {billing.subscriptionId && (
                <span className="text-slate-500 text-sm font-mono">{billing.subscriptionId}</span>
              )}
            </div>

            {billing.status === 'none' || billing.status === 'canceled' ? (
              isAdmin && (
                <form onSubmit={handleSubscribe} className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
                  <input
                    required
                    placeholder="Razorpay Plan ID"
                    value={subscribeForm.planId}
                    onChange={(e) => setSubscribeForm({ ...subscribeForm, planId: e.target.value })}
                    className="glass-input"
                  />
                  <input
                    required
                    type="email"
                    placeholder="Billing email"
                    value={subscribeForm.email}
                    onChange={(e) => setSubscribeForm({ ...subscribeForm, email: e.target.value })}
                    className="glass-input"
                  />
                  <input
                    placeholder="Name (optional)"
                    value={subscribeForm.name}
                    onChange={(e) => setSubscribeForm({ ...subscribeForm, name: e.target.value })}
                    className="glass-input"
                  />
                  <button type="submit" disabled={subscribing} className="btn-primary">
                    {subscribing ? 'Subscribing...' : 'Subscribe'}
                  </button>
                </form>
              )
            ) : (
              isAdmin && (
                <button onClick={handleCancel} disabled={canceling} className="btn-secondary text-red-400">
                  {canceling ? 'Canceling...' : 'Cancel Subscription'}
                </button>
              )
            )}
          </div>
        ) : null}
      </motion.div>

      {/* ---- Spending caps ---- */}
      <motion.div 
        className="glass-panel p-6"
        variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0 } }}
      >
        <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-1">
          <Gauge size={20} className="text-amber-400" />
          Spending Caps
        </h2>
        <p className="text-slate-400 text-sm mb-4">
          Hard monthly USD limits. Requests are blocked once a scope hits its cap.
        </p>

        {isAdmin && (
          <form onSubmit={handleSetCap} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 pb-6 border-b border-white/10">
            <select
              value={capForm.scope}
              onChange={(e) => setCapForm({ ...capForm, scope: e.target.value })}
              className="glass-input"
            >
              <option value="workspace">Entire workspace</option>
              <option value="member">Specific member</option>
            </select>
            {capForm.scope === 'member' ? (
              <select
                required
                value={capForm.memberId}
                onChange={(e) => setCapForm({ ...capForm, memberId: e.target.value })}
                className="glass-input"
              >
                <option value="" disabled>
                  Select a member
                </option>
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.email} ({m.role})
                  </option>
                ))}
              </select>
            ) : (
              <div />
            )}
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Monthly limit (USD)"
              value={capForm.monthlyLimitUsd}
              onChange={(e) => setCapForm({ ...capForm, monthlyLimitUsd: e.target.value })}
              className="glass-input"
            />
            <button type="submit" disabled={capSubmitting} className="btn-primary flex items-center justify-center gap-2">
              <Plus size={16} /> {capSubmitting ? 'Saving...' : 'Set Cap'}
            </button>
          </form>
        )}

        {loading && !caps ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : caps && caps.length === 0 ? (
          <div className="text-center text-slate-500 py-8">No spending caps configured yet.</div>
        ) : (
          <div className="space-y-3">
            {caps?.map((cap) => {
              const pct = cap.monthlyLimitUsd > 0 ? Math.min(100, (cap.currentSpendUsd / cap.monthlyLimitUsd) * 100) : 0;
              const isOver = cap.currentSpendUsd >= cap.monthlyLimitUsd;
              return (
                <div key={cap.id} className="bg-black/20 border border-white/10 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-200">{memberEmail(cap.memberId)}</span>
                      {isOver && <AlertTriangle size={14} className="text-red-400" />}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-400">
                        {formatUsd(cap.currentSpendUsd)} / {formatUsd(cap.monthlyLimitUsd)}
                      </span>
                      {isAdmin && (
                        <button
                          onClick={() => handleRemoveCap(cap.memberId)}
                          className="text-slate-400 hover:text-red-400 p-1 rounded-md hover:bg-red-500/10 transition-colors"
                          title="Remove cap"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${isOver ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : pct > 80 ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
