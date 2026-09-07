/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database Access Assistant — expand/collapse sections (no tab strip).
 *
 * Menu: Dashboard · User Management · Permission · Diff.
 * Permission uses the live dialect-aware panel (same as Database Access).
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileBarChart, UserCog, GitCompare, ShieldCheck } from 'lucide-react';
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
  // Default Users open so AccessView tests that expect user-management on paint
  // keep passing.
  const [open, setOpen] = useState<AccessSection | null>('users');

  const toggle = (id: AccessSection) => {
    setOpen((cur) => (cur === id ? null : id));
  };

  const openPermission = () => {
    setOpen('permission');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" data-testid="access-view">
      <div className="flex-1 min-h-0 flex flex-col">
        {SECTIONS.map((s) => {
          const expanded = open === s.id;
          return (
            <div
              key={s.id}
              className={`border-b border-slate-800 flex flex-col ${expanded ? 'flex-1 min-h-0' : 'shrink-0'}`}
            >
              <button
                type="button"
                data-testid={`access-tab-${s.id}`}
                aria-expanded={expanded}
                onClick={() => toggle(s.id)}
                className={`flex w-full items-center gap-2 px-4 py-2.5 text-left transition ${
                  expanded
                    ? 'bg-slate-900/80 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
                }`}
              >
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                )}
                <s.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs font-semibold">{s.label}</span>
                <span className="ml-auto hidden sm:inline text-[11px] font-normal text-slate-500 truncate max-w-[50%]">
                  {s.hint}
                </span>
              </button>
              {expanded && (
                <div className="flex-1 min-h-0 flex flex-col border-t border-slate-800/80">
                  {s.id === 'dashboard' && <AccessReport />}
                  {s.id === 'users' && (
                    <UserManagement onGrantAccess={(_draft) => openPermission()} />
                  )}
                  {s.id === 'permission' && <AccessPermissionPanel />}
                  {s.id === 'diff' && <PermissionDiff />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
