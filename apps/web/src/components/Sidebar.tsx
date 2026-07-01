'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Key, Shield, LogOut, CreditCard } from 'lucide-react';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'API Keys', href: '/dashboard/keys', icon: Key },
    { name: 'Provider Credentials', href: '/dashboard/credentials', icon: Shield },
    { name: 'Billing & Caps', href: '/dashboard/billing', icon: CreditCard },
  ];

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="w-72 border-r border-white/5 bg-white/[0.02] flex flex-col h-full backdrop-blur-2xl shadow-[4px_0_24px_rgba(0,0,0,0.2)] z-10">
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="w-10 h-10 bg-gradient-to-br from-[#0c0f1a] to-[#06080f] rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 border border-white/10">
            <svg className="w-7 h-7" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Top chevron (cyan-blue) */}
              <polygon points="152,256 280,142 312,142 340,126 196,256" fill="url(#sRay1)" opacity="0.95"/>
              <polygon points="196,256 340,126 372,142 312,172 180,268" fill="url(#sRay1)" opacity="0.55"/>
              {/* Center chevron (indigo) */}
              <polygon points="132,232 380,218 380,248 132,280" fill="url(#sRay2)" opacity="0.95"/>
              <polygon points="132,248 380,238 380,274 132,290" fill="url(#sRay2)" opacity="0.4"/>
              {/* Bottom chevron (purple) */}
              <polygon points="152,256 280,370 312,370 340,386 196,256" fill="url(#sRay3)" opacity="0.95"/>
              <polygon points="196,256 340,386 372,370 312,340 180,244" fill="url(#sRay3)" opacity="0.55"/>
              {/* Convergence point */}
              <rect x="128" y="236" width="40" height="40" rx="8" transform="rotate(45,148,256)" fill="white" opacity="0.95"/>
              <defs>
                <linearGradient id="sRay1" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#2563eb"/><stop offset="100%" stopColor="#38bdf8"/>
                </linearGradient>
                <linearGradient id="sRay2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1"/><stop offset="100%" stopColor="#818cf8"/>
                </linearGradient>
                <linearGradient id="sRay3" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#a78bfa"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="font-bold text-xl tracking-tight text-white">Lumen</span>
        </div>
        
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {links.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors z-10 ${
                isActive 
                  ? 'text-white font-medium' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-white/10 rounded-xl border border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                  initial={false}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  style={{ zIndex: -1 }}
                />
              )}
              <link.icon size={20} className={isActive ? 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.8)]' : 'text-slate-500'} />
              <span className="relative z-10">{link.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/5">
        <button 
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors group"
        >
          <LogOut size={20} className="group-hover:text-red-400 transition-colors" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </div>
  );
}
