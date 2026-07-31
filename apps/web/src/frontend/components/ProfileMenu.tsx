import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Palette, ChevronDown, ArrowUpCircle, Globe, Shield } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { checkForUpdates, type UpdateInfo } from '../api/updatesApi';
import { AdminAccessPanel } from './AdminAccessPanel';

// Lazy so a SettingsPanel/HMR failure cannot empty this module's exports
// (which surfaces as: ProfileMenu.tsx does not provide export named 'ProfileMenu').
const SettingsPanel = lazy(() =>
  import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
);

export function ProfileMenu(): React.ReactElement | null {
  const { user, logout, localSingleUser } = useAuthStore();
  const canAdminUsers = useAuthStore((s) => s.can('admin.users'));
  const canAdminRoles = useAuthStore((s) => s.can('admin.roles'));
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    let alive = true;
    checkForUpdates().then((u) => alive && setUpdate(u));
    return () => {
      alive = false;
    };
  }, []);

  const placeMenu = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  if (!user) return null;

  const updateAvailable = !!update?.updateAvailable;

  const menu = open && menuPos
    ? createPortal(
        <div
          ref={menuRef}
          data-testid="profile-menu-dropdown"
          className="fixed w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[300] overflow-hidden"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Signed in as</p>
            <p className="text-sm text-slate-200 truncate" title={user.email}>
              {user.email}
            </p>
            {user.role && (
              <p className="text-[11px] text-amber-300/90 mt-0.5 capitalize" data-testid="profile-role">
                Role: {user.role}
              </p>
            )}
          </div>

          {updateAvailable && (
            <a
              href={update?.url || undefined}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-amber-300 hover:bg-amber-950/20 transition cursor-pointer border-b border-slate-800"
            >
              <ArrowUpCircle className="w-4 h-4" /> Update available · v{update?.latest}
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              setShowSettings(true);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer"
          >
            <Palette className="w-4 h-4" /> User Preference
          </button>

          {(canAdminUsers || canAdminRoles) && (
            <button
              type="button"
              data-testid="profile-access-control"
              onClick={() => {
                setShowAdmin(true);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer"
            >
              <Shield className="w-4 h-4" /> Access control
            </button>
          )}

          <a
            href="https://foxschema.com"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer"
          >
            <Globe className="w-4 h-4" /> foxschema.com
          </a>

          {!localSingleUser && (
            <button
              type="button"
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition cursor-pointer border-t border-slate-800 bg-slate-950/40"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={ref} className="relative z-[200]">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-md border border-slate-700 hover:border-slate-600 hover:bg-slate-800/60 transition cursor-pointer"
      >
        <span className="relative w-6 h-6 rounded-full accent-grad on-accent-fg text-xs font-bold flex items-center justify-center uppercase">
          {user.email.charAt(0)}
          {updateAvailable && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" />
          )}
        </span>
        <span className="text-sm text-slate-300 max-w-[160px] truncate hidden sm:block">{user.email}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </button>

      {menu}

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      <AdminAccessPanel open={showAdmin} onClose={() => setShowAdmin(false)} />
    </div>
  );
}

export default ProfileMenu;
