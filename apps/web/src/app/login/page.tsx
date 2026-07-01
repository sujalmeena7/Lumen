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
            <svg className="w-10 h-10" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="lGlowOrb" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="1"/>
                  <stop offset="50%" stopColor="#6366f1" stopOpacity="0.8"/>
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0"/>
                </radialGradient>
                <linearGradient id="lRing1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38bdf8"/>
                  <stop offset="100%" stopColor="#818cf8"/>
                </linearGradient>
                <linearGradient id="lRing2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#a855f7"/>
                  <stop offset="100%" stopColor="#3b82f6"/>
                </linearGradient>
              </defs>

              <circle cx="256" cy="256" r="160" fill="url(#lGlowOrb)" opacity="0.6"/>
              <circle cx="256" cy="256" r="64" fill="url(#lGlowOrb)" opacity="0.9"/>
              <circle cx="256" cy="256" r="24" fill="#ffffff"/>

              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="url(#lRing1)" strokeWidth="16" transform="rotate(-30 256 256)" strokeDasharray="800" strokeDashoffset="100" strokeLinecap="round"/>
              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="url(#lRing2)" strokeWidth="16" transform="rotate(30 256 256)" strokeDasharray="800" strokeDashoffset="100" strokeLinecap="round"/>
              
              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="white" strokeWidth="3" transform="rotate(-30 256 256)" opacity="0.3"/>
              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="white" strokeWidth="3" transform="rotate(30 256 256)" opacity="0.3"/>
              
              <circle cx="118" cy="176" r="20" fill="#38bdf8" opacity="0.6"/>
              <circle cx="118" cy="176" r="10" fill="#ffffff"/>
              
              <circle cx="394" cy="176" r="20" fill="#a855f7" opacity="0.6"/>
              <circle cx="394" cy="176" r="10" fill="#ffffff"/>
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
