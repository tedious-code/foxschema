/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Left activity rail: one workspace at a time. Top-level labels and RBAC come
 * from COMMUNITY_NAV in `@foxschema/shared` so the shell and permission catalog
 * stay aligned.
 */
import React, { useMemo } from 'react';
import {
  Camera,
  GitCompareArrows,
  Settings,
  ShieldCheck,
  Terminal,
  Workflow,
  Wrench,
} from 'lucide-react';
import { COMMUNITY_NAV, filterNav, type Permission } from '@foxschema/shared';
import { useAuthStore } from '@/app/store/authStore';
import { useUiStore, type ActiveView } from '@/app/store/uiStore';
import { FoxLogo } from './FoxLogo';

/** Maps COMMUNITY_NAV top-level ids onto shell ActiveView values. */
const NAV_TO_VIEW: Record<string, ActiveView> = {
  compare: 'sync',
  editor: 'sqlEditor',
  access: 'access',
  workflow: 'workflow',
};

const NAV_ICONS: Record<string, React.ElementType> = {
  compare: GitCompareArrows,
  editor: Terminal,
  access: ShieldCheck,
  workflow: Workflow,
};

const NAV_TEST_IDS: Record<string, string> = {
  compare: 'view-sync-btn',
  editor: 'view-sql-editor-btn',
  access: 'view-access-btn',
  workflow: 'view-workflow-btn',
};

/** Rail order: Compare · Editor · Utils · Access · Workflow · Snapshots. */
const RAIL_ORDER = ['compare', 'editor', 'utilities', 'access', 'workflow', 'snapshots'] as const;

export function ActivityRail(): React.ReactElement | null {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const can = useAuthStore((s) => s.can);

  const visible = useMemo(() => {
    const allowed = (permission: Permission) => can(permission);
    const nav = filterNav(COMMUNITY_NAV, allowed, { workflow: true });
    const byId = new Map(nav.map((item) => [item.id, item]));

    const items: {
      view: ActiveView;
      testId: string;
      label: string;
      icon: React.ElementType;
    }[] = [];

    for (const id of RAIL_ORDER) {
      if (id === 'utilities') {
        if (!can('utility.access')) continue;
        items.push({
          view: 'utilities',
          testId: 'view-utilities-btn',
          label: 'Utils',
          icon: Wrench,
        });
        continue;
      }
      if (id === 'snapshots') {
        if (!can('compare.history') && !can('schema.browse')) continue;
        items.push({
          view: 'snapshots',
          testId: 'sync-pane-history-btn',
          label: 'Snapshots',
          icon: Camera,
        });
        continue;
      }
      const navItem = byId.get(id);
      if (!navItem) continue;
      const view = NAV_TO_VIEW[id];
      const icon = NAV_ICONS[id];
      const testId = NAV_TEST_IDS[id];
      if (!view || !icon || !testId) continue;
      items.push({ view, testId, label: navItem.label, icon });
    }
    return items;
  }, [can]);

  return (
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
      <div className="mt-auto" />
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
    </nav>
  );
}
