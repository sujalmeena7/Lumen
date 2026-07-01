'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        router.push('/dashboard');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to login');
      }
    } catch {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-[#0c0f1a] to-[#06080f] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/10 shadow-lg shadow-blue-500/20">
            <svg className="w-10 h-10" viewBox="110 110 290 290" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Top chevron (cyan-blue) */}
              <polygon points="152,256 280,142 312,142 340,126 196,256" fill="url(#lRay1)" opacity="0.95"/>
              <polygon points="196,256 340,126 372,142 312,172 180,268" fill="url(#lRay1)" opacity="0.55"/>
              {/* Center chevron (indigo) */}
              <polygon points="132,232 380,218 380,248 132,280" fill="url(#lRay2)" opacity="0.95"/>
              <polygon points="132,248 380,238 380,274 132,290" fill="url(#lRay2)" opacity="0.4"/>
              {/* Bottom chevron (purple) */}
              <polygon points="152,256 280,370 312,370 340,386 196,256" fill="url(#lRay3)" opacity="0.95"/>
              <polygon points="196,256 340,386 372,370 312,340 180,244" fill="url(#lRay3)" opacity="0.55"/>
              {/* Convergence point */}
              <rect x="128" y="236" width="40" height="40" rx="8" transform="rotate(45,148,256)" fill="white" opacity="0.95"/>
              <defs>
                <linearGradient id="lRay1" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#2563eb"/><stop offset="100%" stopColor="#38bdf8"/>
                </linearGradient>
                <linearGradient id="lRay2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1"/><stop offset="100%" stopColor="#818cf8"/>
                </linearGradient>
                <linearGradient id="lRay3" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#a78bfa"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
            Lumen
          </h1>
          <p className="text-slate-400 mt-2">Sign in to your dashboard</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="glass-input w-full"
              placeholder="demo@router.dev"
            />
          </div>
          
          {error && <div className="text-red-400 text-sm">{error}</div>}
          
          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
