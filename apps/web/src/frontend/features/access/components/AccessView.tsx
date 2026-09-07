/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database Access Assistant — horizontal capsule menu (same pattern as
 * Workspace / Schema Sync sub-nav).
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
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: FileBarChart },
  { id: 'users', label: 'User Management', icon: UserCog },
  { id: 'permission', label: 'Permission', icon: ShieldCheck },
  { id: 'diff', label: 'Diff', icon: GitCompare },
];

export const AccessView: React.FC = () => {
  // Default Users so AccessView tests that expect user-management on paint keep
  // passing.
  const [section, setSection] = useState<AccessSection>('users');

  const openPermission = () => {
    setSection('permission');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="access-view">
      <nav
        className="shrink-0 mx-3 mt-2 mb-0 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/50 p-0.5"
        aria-label="Access"
        data-testid="access-menu"
      >
        <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Access
        </span>
        {SECTIONS.map((s) => {
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`access-tab-${s.id}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                active
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <s.icon className="w-3.5 h-3.5 shrink-0" />
              {s.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {section === 'dashboard' && <AccessReport />}
        {section === 'users' && <UserManagement onGrantAccess={(_draft) => openPermission()} />}
        {section === 'permission' && <AccessPermissionPanel />}
        {section === 'diff' && <PermissionDiff />}
      </div>
    </div>
  );
};
