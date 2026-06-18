import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Type, Palette, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useUiStore, ACCENTS, type FontSize, type AccentId } from '../store/uiStore';
import { CAPABILITIES } from '../edition';

// Community desktop is local single-user: no account identity or sign-out.
const LOCAL_SINGLE_USER = !CAPABILITIES.multiUser;

const FONT_SIZES: { id: FontSize; label: string }[] = [
  { id: 'sm', label: 'A−' },
  { id: 'md', label: 'A' },
  { id: 'lg', label: 'A+' },
];

export const ProfileMenu: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { fontSize, accent, setFontSize, setAccent } = useUiStore();
  const [open, setOpen] = useState(false);
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
        <span className="w-6 h-6 rounded-full accent-grad text-slate-950 text-xs font-bold flex items-center justify-center uppercase">
          {user.email.charAt(0)}
        </span>
        {!LOCAL_SINGLE_USER && (
          <span className="text-sm text-slate-300 max-w-[160px] truncate hidden sm:block">{user.email}</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {!LOCAL_SINGLE_USER && (
            <div className="px-4 py-3 border-b border-slate-800">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Signed in as</p>
              <p className="text-sm text-slate-200 truncate" title={user.email}>{user.email}</p>
            </div>
          )}

          <div className="px-4 py-3 border-b border-slate-800 space-y-3">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-bold flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5" /> Font Size
            </p>
            <div className="flex gap-1.5">
              {FONT_SIZES.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFontSize(f.id)}
                  className={`flex-1 py-1.5 rounded-md border text-sm font-bold transition cursor-pointer ${
                    fontSize === f.id
                      ? 'accent-text border-current bg-slate-800'
                      : 'text-slate-400 border-slate-700 hover:bg-slate-800/60'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-400 uppercase tracking-wider font-bold flex items-center gap-1.5 pt-1">
              <Palette className="w-3.5 h-3.5" /> Accent Color
            </p>
            <div className="flex gap-2">
              {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setAccent(id)}
                  title={ACCENTS[id].label}
                  className={`w-7 h-7 rounded-full transition cursor-pointer ${
                    accent === id ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-white/70' : 'hover:scale-110'
                  }`}
                  style={{ backgroundImage: `linear-gradient(to top right, ${ACCENTS[id].from}, ${ACCENTS[id].to})` }}
                />
              ))}
            </div>
          </div>

          {!LOCAL_SINGLE_USER && (
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-rose-300 hover:bg-rose-950/20 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
};
