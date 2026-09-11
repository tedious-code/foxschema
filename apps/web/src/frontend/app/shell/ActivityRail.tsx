/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Left activity rail: one workspace at a time. Credentials, Applies, and the
 * account menu live here so the Compare toolbar keeps horizontal room.
 */
import React, { useState } from 'react';
import { Camera, GitCompareArrows, History, KeyRound, Settings, ShieldCheck, Terminal, Wrench } from 'lucide-react';
import { useAuthStore } from '@/app/store/authStore';
import { useUiStore, type ActiveView } from '@/app/store/uiStore';
import { CredentialManager } from '@/features/connections';
import { MigrationHistory } from '@/features/migrations';
import { FoxLogo } from './FoxLogo';
import ProfileMenuDefault, { ProfileMenu as ProfileMenuNamed } from './ProfileMenu';

const ProfileMenu = ProfileMenuNamed ?? ProfileMenuDefault;

const ITEMS: {
  view: ActiveView;
  testId: string;
  label: string;
  icon: React.ElementType;
  permission: 'schema' | 'editor' | 'utilities' | 'access' | 'snapshots';
}[] = [
  {
    view: 'sync',
    testId: 'view-sync-btn',
    label: 'Sync',
    icon: GitCompareArrows,
    permission: 'schema',
  },
  {
    view: 'sqlEditor',
    testId: 'view-sql-editor-btn',
    label: 'SQL',
    icon: Terminal,
    permission: 'editor',
  },
  {
    view: 'utilities',
    testId: 'view-utilities-btn',
    label: 'Utils',
    icon: Wrench,
    permission: 'utilities',
  },
  {
    view: 'access',
    testId: 'view-access-btn',
    label: 'Access',
    icon: ShieldCheck,
    permission: 'access',
  },
  {
    view: 'snapshots',
    testId: 'sync-pane-history-btn',
    label: 'Snapshots',
    icon: Camera,
    permission: 'snapshots',
  },
];

export function ActivityRail(): React.ReactElement | null {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const canSchemaBrowse = useAuthStore((s) => s.can('schema.browse'));
  const canSchemaCompare = useAuthStore((s) => s.can('schema.compare'));
  const canEditorAccess = useAuthStore((s) => s.can('editor.access'));
  const canUtilityAccess = useAuthStore((s) => s.can('utility.access'));
  const [showCredentials, setShowCredentials] = useState(false);
  const [showApplies, setShowApplies] = useState(false);

  const allowed = (permission: (typeof ITEMS)[number]['permission']): boolean => {
    if (permission === 'schema') return canSchemaBrowse || canSchemaCompare;
    if (permission === 'editor') return canEditorAccess;
    if (permission === 'utilities') return canUtilityAccess;
    if (permission === 'snapshots') return canSchemaBrowse;
    return true;
  };

  const visible = ITEMS.filter((item) => allowed(item.permission));

  return (
    <>
      <nav
        data-testid="workspace-switcher"
        aria-label="Workspace"
        className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-800 bg-slate-900/90 py-2"
      >
        <button
          type="button"
          data-testid="home-open-btn"
          title="Home"
          aria-label="Home"
          aria-current={activeView === 'home' ? 'page' : undefined}
          onClick={() => setActiveView('home')}
          className={`mb-2 flex h-10 w-10 items-center justify-center rounded-md transition ${
            activeView === 'home'
              ? 'bg-slate-800 ring-1 ring-slate-600'
              : 'hover:bg-slate-800/60'
          }`}
        >
          <FoxLogo size={28} />
        </button>
        {visible.map((item) => {
          const on = activeView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              data-testid={item.testId}
              title={item.label}
              onClick={() => setActiveView(item.view)}
              className={`flex w-12 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[9px] font-bold uppercase tracking-wide transition ${
                on
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}

        <div className="mt-auto flex w-full flex-col items-center gap-1 border-t border-slate-800/80 pt-2">
          <button
            type="button"
            data-testid="credentials-btn"
            title="Credentials"
            aria-label="Credentials"
            onClick={() => setShowCredentials(true)}
            className="flex w-12 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[9px] font-bold uppercase tracking-wide text-cyan-400 transition hover:bg-slate-800/60 hover:text-cyan-300"
          >
            <KeyRound className="h-4 w-4" />
            Creds
          </button>
          <button
            type="button"
            data-testid="history-btn"
            title="Applies"
            aria-label="Applies"
            onClick={() => setShowApplies(true)}
            className="flex w-12 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
          >
            <History className="h-4 w-4" />
            Applies
          </button>
          <div className="mt-1 flex w-12 justify-center">
            <ProfileMenu />
          </div>
          <button
            type="button"
            data-testid="view-settings-btn"
            title="Preferences"
            aria-label="Preferences"
            aria-current={activeView === 'settings' ? 'page' : undefined}
            onClick={() => setActiveView('settings')}
            className={`flex w-12 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[9px] font-bold uppercase tracking-wide transition ${
              activeView === 'settings'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <Settings className="h-4 w-4" />
            Prefs
          </button>
        </div>
      </nav>

      <CredentialManager open={showCredentials} onClose={() => setShowCredentials(false)} />
      <MigrationHistory open={showApplies} onClose={() => setShowApplies(false)} />
    </>
  );
}
