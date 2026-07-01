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
            <svg className="w-8 h-8" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="sGlowOrb" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="1"/>
                  <stop offset="50%" stopColor="#6366f1" stopOpacity="0.8"/>
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0"/>
                </radialGradient>
                <linearGradient id="sRing1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38bdf8"/>
                  <stop offset="100%" stopColor="#818cf8"/>
                </linearGradient>
                <linearGradient id="sRing2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#a855f7"/>
                  <stop offset="100%" stopColor="#3b82f6"/>
                </linearGradient>
              </defs>

              <circle cx="256" cy="256" r="160" fill="url(#sGlowOrb)" opacity="0.6"/>
              <circle cx="256" cy="256" r="64" fill="url(#sGlowOrb)" opacity="0.9"/>
              <circle cx="256" cy="256" r="24" fill="#ffffff"/>

              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="url(#sRing1)" strokeWidth="16" transform="rotate(-30 256 256)" strokeDasharray="800" strokeDashoffset="100" strokeLinecap="round"/>
              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="url(#sRing2)" strokeWidth="16" transform="rotate(30 256 256)" strokeDasharray="800" strokeDashoffset="100" strokeLinecap="round"/>
              
              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="white" strokeWidth="3" transform="rotate(-30 256 256)" opacity="0.3"/>
              <ellipse cx="256" cy="256" rx="160" ry="60" fill="none" stroke="white" strokeWidth="3" transform="rotate(30 256 256)" opacity="0.3"/>
              
              <circle cx="118" cy="176" r="20" fill="#38bdf8" opacity="0.6"/>
              <circle cx="118" cy="176" r="10" fill="#ffffff"/>
              
              <circle cx="394" cy="176" r="20" fill="#a855f7" opacity="0.6"/>
              <circle cx="394" cy="176" r="10" fill="#ffffff"/>
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
