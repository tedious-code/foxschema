import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Palette, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { CAPABILITIES } from '../edition';
import { SettingsPanel } from './SettingsPanel';

// Community desktop is local single-user: no account identity or sign-out.
const LOCAL_SINGLE_USER = !CAPABILITIES.multiUser;

export const ProfileMenu: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-md border border-slate-700 hover:border-slate-600 hover:bg-slate-800/60 transition cursor-pointer"
      >
        <span className="w-6 h-6 rounded-full accent-grad on-accent-fg text-xs font-bold flex items-center justify-center uppercase">
          {user.email.charAt(0)}
        </span>
        {!LOCAL_SINGLE_USER && (
          <span className="text-sm text-slate-300 max-w-[160px] truncate hidden sm:block">{user.email}</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {!LOCAL_SINGLE_USER && (
            <div className="px-4 py-3 border-b border-slate-800">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Signed in as</p>
              <p className="text-sm text-slate-200 truncate" title={user.email}>{user.email}</p>
            </div>
          )}

          <button
            onClick={() => {
              setShowSettings(true);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer"
          >
            <Palette className="w-4 h-4" /> User Preference
          </button>

          {!LOCAL_SINGLE_USER && (
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-rose-300 hover:bg-rose-950/20 transition cursor-pointer border-t border-slate-800"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          )}
        </div>
      )}

      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
};
