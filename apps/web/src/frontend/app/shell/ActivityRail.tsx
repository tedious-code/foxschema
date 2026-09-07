/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Left activity rail: one workspace at a time. Replaces the stacked
 * Workspace switcher that lived in the top toolbar.
 */
import React from 'react';
import { Camera, GitCompareArrows, ShieldCheck, Terminal } from 'lucide-react';
import { useAuthStore } from '@/app/store/authStore';
import { useUiStore, type ActiveView } from '@/app/store/uiStore';
import { FoxLogo } from './FoxLogo';

const ITEMS: {
  view: ActiveView;
  testId: string;
  label: string;
  icon: React.ElementType;
  permission: 'schema' | 'editor' | 'access' | 'snapshots';
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

  const allowed = (permission: (typeof ITEMS)[number]['permission']): boolean => {
    if (permission === 'schema') return canSchemaBrowse || canSchemaCompare;
    if (permission === 'editor') return canEditorAccess;
    if (permission === 'snapshots') return canSchemaBrowse;
    return true;
  };

  const visible = ITEMS.filter((item) => allowed(item.permission));
  if (visible.length === 0) return null;

  return (
    <nav
      data-testid="workspace-switcher"
      aria-label="Workspace"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-800 bg-slate-900/90 py-2"
    >
      <div className="mb-2 flex h-10 w-10 items-center justify-center">
        <FoxLogo size={28} />
      </div>
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
    </nav>
  );
}
