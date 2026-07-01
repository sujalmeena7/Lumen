'use client';

import { useCallback, useEffect, useState } from 'react';
import { DollarSign, Gauge, Layers, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface ModelBreakdownEntry {
  model: string;
  provider: string;
  requests: number;
  totalCostUsd: number;
  totalSavedUsd: number;
  avgLatencyMs: number;
}

interface AnalyticsSummary {
  range: { since: string; until: string };
  totalRequests: number;
  successfulRequests: number;
  errorRequests: number;
  blockedRequests: number;
  avgLatencyMs: number;
  avgLatencyMsNonCached: number;
  cacheHitCount: number;
  cacheHitRate: number;
  totalCostUsd: number;
  totalBaselineCostUsd: number;
  totalSavedUsd: number;
  savedPercent: number;
  byModel: ModelBreakdownEntry[];
}

type RangePreset = '24h' | '7d' | '30d' | '90d';

const PRESET_LABELS: Record<RangePreset, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

function presetToSince(preset: RangePreset): Date {
  const hours = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 }[preset];
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function formatUsd(n: number): string {
  // Real per-request LLM costs are frequently fractions of a cent; showing
  // only 2 decimals would misleadingly display real savings as "$0.00".
  if (n !== 0 && Math.abs(n) < 0.01) {
    return `$${n.toFixed(4)}`;
  }
  return `$${n.toFixed(2)}`;
}

export default function AnalyticsOverview() {
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: RangePreset) => {
    setLoading(true);
    setError(null);
    try {
      const since = presetToSince(p).toISOString();
      const res = await fetch(`/api/analytics?since=${encodeURIComponent(since)}`);
      if (!res.ok) {
        throw new Error('Failed to load analytics');
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError('Could not load analytics. Try again shortly.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(preset);
  }, [preset, load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
            Overview
          </h1>
          <p className="text-slate-400 mt-2">Requests, latency, and savings for your workspace.</p>
        </div>

        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
          {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                preset === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="glass-panel p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">{error}</div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-panel p-6 h-28 animate-pulse" />
          ))}
        </div>
      ) : data && data.totalRequests === 0 ? (
        <div className="glass-panel p-10 text-center border-dashed border-white/20">
          <p className="text-slate-300 font-medium">No requests yet in this time range.</p>
          <p className="text-slate-500 text-sm mt-2">
            Send a request to <code className="text-slate-400">/v1/chat/completions</code> using a gateway key
            from this workspace, then refresh — your requests, latency, and Money Saved will show up here.
          </p>
        </div>
      ) : data ? (
        <>
          <motion.div 
            className="grid grid-cols-1 md:grid-cols-4 gap-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ staggerChildren: 0.1 }}
          >
            <StatCard
              icon={<Layers size={18} className="text-blue-400" />}
              label="Total Requests"
              value={data.totalRequests.toLocaleString()}
              sub={`${data.successfulRequests} success · ${data.errorRequests} error · ${data.blockedRequests} blocked`}
            />
            <StatCard
              icon={<Gauge size={18} className="text-cyan-400" />}
              label="Avg Latency"
              value={`${data.avgLatencyMs} ms`}
              sub={`${data.avgLatencyMsNonCached} ms excluding cache hits`}
            />
            <StatCard
              icon={<Zap size={18} className="text-amber-400" />}
              label="Cache Hit Rate"
              value={`${(data.cacheHitRate * 100).toFixed(1)}%`}
              sub={`${data.cacheHitCount} of ${data.totalRequests} requests`}
            />
            <StatCard
              icon={<DollarSign size={18} className="text-emerald-400" />}
              label="Money Saved"
              value={formatUsd(data.totalSavedUsd)}
              sub={`${data.savedPercent.toFixed(1)}% vs baseline · ${formatUsd(data.totalCostUsd)} actual spend`}
              highlight
            />
          </motion.div>

          <motion.div 
            className="glass-panel overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">Per-Model Breakdown</h2>
              <p className="text-slate-400 text-sm mt-1">
                Baseline cost assumes every request used the premium model instead.
              </p>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-black/20 text-slate-300 border-b border-white/10">
                <tr>
                  <th className="px-6 py-3 font-medium">MODEL</th>
                  <th className="px-6 py-3 font-medium">PROVIDER</th>
                  <th className="px-6 py-3 font-medium">REQUESTS</th>
                  <th className="px-6 py-3 font-medium">AVG LATENCY</th>
                  <th className="px-6 py-3 font-medium">COST</th>
                  <th className="px-6 py-3 font-medium">SAVED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.byModel.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                      No model activity in this range.
                    </td>
                  </tr>
                ) : (
                  data.byModel.map((m) => (
                    <tr key={m.model} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-200">{m.model}</td>
                      <td className="px-6 py-3 text-slate-400 capitalize">{m.provider}</td>
                      <td className="px-6 py-3 text-slate-400">{m.requests}</td>
                      <td className="px-6 py-3 text-slate-400">{m.avgLatencyMs} ms</td>
                      <td className="px-6 py-3 text-slate-400">{formatUsd(m.totalCostUsd)}</td>
                      <td className="px-6 py-3 text-emerald-400">{formatUsd(m.totalSavedUsd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </motion.div>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`glass-panel p-6 cursor-default transition-shadow hover:shadow-blue-500/10 hover:shadow-2xl ${highlight ? 'border-blue-500/30 bg-blue-500/5' : ''}`}
    >
      <div className="flex items-center gap-2 text-slate-400 font-medium text-sm">
        {icon}
        {label}
      </div>
      <p className={`text-3xl font-bold mt-2 ${highlight ? 'text-blue-400' : 'text-white'}`}>{value}</p>
      <p className="text-slate-500 text-xs mt-2">{sub}</p>
    </motion.div>
  );
}
