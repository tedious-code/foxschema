/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database Access Assistant — left menu + content panel.
 *
 * Menu: Dashboard · User Management · Permission · Diff.
 * Permission uses the live dialect-aware panel (same as Database Access).
 */
import React, { useState } from 'react';
import { FileBarChart, UserCog, GitCompare, ShieldCheck } from 'lucide-react';
import { PermissionDiff } from './PermissionDiff';
import { AccessReport } from './AccessReport';
import { UserManagement } from './UserManagement';
import { AccessPermissionPanel } from './AccessPermissionPanel';

export type AccessSection = 'dashboard' | 'users' | 'permission' | 'diff';

const SECTIONS: {
  id: AccessSection;
  label: string;
  icon: React.ElementType;
  hint: string;
}[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: FileBarChart,
    hint: 'Who can reach what',
  },
  {
    id: 'users',
    label: 'User Management',
    icon: UserCog,
    hint: 'Create and drop database accounts',
  },
  {
    id: 'permission',
    label: 'Permission',
    icon: ShieldCheck,
    hint: 'Grant and revoke — dialect-aware SQL',
  },
  {
    id: 'diff',
    label: 'Diff',
    icon: GitCompare,
    hint: 'Reconcile desired vs current grants',
  },
];

export const AccessView: React.FC = () => {
  // Default Users so AccessView tests that expect user-management on paint keep
  // passing.
  const [section, setSection] = useState<AccessSection>('users');

  const openPermission = () => {
    setSection('permission');
  };

  return (
    <div className="flex-1 flex min-h-0" data-testid="access-view">
      <nav
        className="w-52 shrink-0 border-r border-slate-800 bg-slate-950/40 flex flex-col py-2"
        aria-label="Access"
        data-testid="access-menu"
      >
        {SECTIONS.map((s) => {
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`access-tab-${s.id}`}
              aria-current={active ? 'page' : undefined}
              title={s.hint}
              onClick={() => setSection(s.id)}
              className={`mx-2 mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition ${
                active
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-200'
              }`}
            >
              <s.icon className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs font-semibold truncate">{s.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {section === 'dashboard' && <AccessReport />}
        {section === 'users' && <UserManagement onGrantAccess={(_draft) => openPermission()} />}
        {section === 'permission' && <AccessPermissionPanel />}
        {section === 'diff' && <PermissionDiff />}
      </div>
    </div>
  );
};
