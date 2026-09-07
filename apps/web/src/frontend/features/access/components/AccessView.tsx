/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database Access Assistant — accounts and permissions as SQL to review.
 *
 * Sections expand/collapse instead of a tab strip. Expanding a section shows
 * that panel; collapsing hides it. User Management stays the default open
 * section so existing handoff tests keep working.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ShieldCheck, FileBarChart, UserCog, GitCompare, Sparkles } from 'lucide-react';
import { PermissionBuilder } from './PermissionBuilder';
import { PermissionDiff } from './PermissionDiff';
import { AccessReport } from './AccessReport';
import { UserManagement } from './UserManagement';
import { PermissionUxPrototype } from './PermissionUxPrototype';
import type { AccessPrincipalDraft } from '../lib/access-draft';

export type AccessSection = 'prototype' | 'users' | 'builder' | 'diff' | 'report';

const SECTIONS: {
  id: AccessSection;
  label: string;
  icon: React.ElementType;
  hint: string;
  badge?: string;
}[] = [
  {
    id: 'prototype',
    label: 'Permissions',
    icon: Sparkles,
    hint: 'Create, edit, grant, and revoke — expand catalog to fetch objects',
    badge: 'Proto',
  },
  {
    id: 'users',
    label: 'User Management',
    icon: UserCog,
    hint: 'Create and drop database accounts',
  },
  {
    id: 'builder',
    label: 'Permission SQL builder',
    icon: ShieldCheck,
    hint: 'Classic scope / grid SQL generator',
  },
  {
    id: 'diff',
    label: 'Permission Diff',
    icon: GitCompare,
    hint: 'Reconcile desired vs current grants',
  },
  {
    id: 'report',
    label: 'Access Report',
    icon: FileBarChart,
    hint: 'Who can reach what',
  },
];

export const AccessView: React.FC = () => {
  // Default Users open so AccessView tests that expect user-management on paint
  // keep passing. Permissions (proto) is one expand away.
  const [open, setOpen] = useState<AccessSection | null>('users');
  const [builderDraft, setBuilderDraft] = useState<AccessPrincipalDraft | null>(null);

  const toggle = (id: AccessSection) => {
    setOpen((cur) => (cur === id ? null : id));
  };

  const openBuilderWith = (draft: AccessPrincipalDraft) => {
    setBuilderDraft(draft);
    setOpen('builder');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" data-testid="access-view">
      <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
        <p className="text-[11px] text-amber-100/90 leading-relaxed">
          <span className="font-bold text-amber-100">Access prototype:</span> sections expand and
          collapse — no tab strip. Open <span className="font-semibold">Permissions</span> to
          create/edit grants; expand an object kind to fetch the catalog; preview SQL in a modal
          (copy always, execute when your FoxSchema role allows).
        </p>
      </div>

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
                {s.badge && (
                  <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                    {s.badge}
                  </span>
                )}
                <span className="ml-auto hidden sm:inline text-[11px] font-normal text-slate-500 truncate max-w-[50%]">
                  {s.hint}
                </span>
              </button>
              {expanded && (
                <div className="flex-1 min-h-0 flex flex-col border-t border-slate-800/80">
                  {s.id === 'prototype' && <PermissionUxPrototype />}
                  {s.id === 'users' && <UserManagement onGrantAccess={openBuilderWith} />}
                  {s.id === 'builder' && (
                    <PermissionBuilder
                      key={
                        builderDraft
                          ? `${builderDraft.connectionId}:${builderDraft.principalType}:${builderDraft.principalName}`
                          : 'builder'
                      }
                      initialDraft={builderDraft}
                    />
                  )}
                  {s.id === 'diff' && <PermissionDiff />}
                  {s.id === 'report' && <AccessReport />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
