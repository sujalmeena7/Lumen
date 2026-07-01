'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertCircle, Mail, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError('');
    // Simulate Google auth for now, or this could redirect to /api/auth/google
    setTimeout(() => {
      handleLogin({ preventDefault: () => {} } as React.FormEvent);
    }, 1000);
  };

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#02040a] relative overflow-hidden">
      {/* Background glowing effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="glass-panel p-10 w-full max-w-[420px] relative z-10 border border-white/10 shadow-2xl shadow-blue-900/20 backdrop-blur-xl"
      >
        <motion.div variants={itemVariants} className="text-center mb-10">
          <div className="w-20 h-20 bg-gradient-to-br from-[#0c0f1a] to-[#06080f] rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-xl shadow-blue-500/20 relative group cursor-pointer overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            {/* Prism Logo */}
            <svg className="w-12 h-12 relative z-10 transition-transform duration-500 group-hover:scale-110" viewBox="110 110 290 290" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="152,256 280,142 312,142 340,126 196,256" fill="url(#lRay1)" opacity="0.95"/>
              <polygon points="196,256 340,126 372,142 312,172 180,268" fill="url(#lRay1)" opacity="0.55"/>
              <polygon points="132,232 380,218 380,248 132,280" fill="url(#lRay2)" opacity="0.95"/>
              <polygon points="132,248 380,238 380,274 132,290" fill="url(#lRay2)" opacity="0.4"/>
              <polygon points="152,256 280,370 312,370 340,386 196,256" fill="url(#lRay3)" opacity="0.95"/>
              <polygon points="196,256 340,386 372,370 312,340 180,244" fill="url(#lRay3)" opacity="0.55"/>
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
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-white via-blue-100 to-blue-400">
            Welcome Back
          </h1>
          <p className="text-slate-400 mt-3 font-medium">Sign in to your Lumen dashboard</p>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-6">
          <button 
            onClick={handleGoogleLogin}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all duration-300 font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {googleLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink-0 mx-4 text-xs font-medium text-slate-500 uppercase tracking-widest">
              Or continue with email
            </span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-400 transition-colors">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 focus:border-blue-500/50 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                  placeholder="name@company.com"
                />
              </div>
            </div>
            
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }} 
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm font-medium"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </motion.div>
            )}
            
            <button 
              type="submit" 
              disabled={loading || googleLoading} 
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium py-3.5 rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Sign In <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </motion.div>
        
        <motion.p variants={itemVariants} className="text-center text-xs text-slate-500 mt-8">
          By signing in, you agree to our <a href="#" className="text-slate-300 hover:text-white underline underline-offset-2 transition-colors">Terms of Service</a> and <a href="#" className="text-slate-300 hover:text-white underline underline-offset-2 transition-colors">Privacy Policy</a>.
        </motion.p>
      </motion.div>
    </div>
  );
}
