/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database Access Assistant — accounts and permissions as SQL to review.
 *
 * Fox Schema builds and explains SQL; it does not create accounts, hold
 * credentials, or apply access changes. The database stays the source of truth.
 */
import React, { useState } from 'react';
import { ShieldCheck, FileBarChart, UserCog, GitCompare, Sparkles } from 'lucide-react';
import { PermissionBuilder } from './PermissionBuilder';
import { PermissionDiff } from './PermissionDiff';
import { AccessReport } from './AccessReport';
import { UserManagement } from './UserManagement';
import { PermissionUxPrototype } from './PermissionUxPrototype';
import type { AccessPrincipalDraft } from '../lib/access-draft';

export type AccessTab = 'prototype' | 'users' | 'builder' | 'diff' | 'report';

// Ordered the way the work runs: make an account, give it access, then review
// everything. Granting and checking what a principal already has were two tabs
// asking for the same connection and name; they are one screen now.
// The Prototype tab is temporary review UI for the next Permissions redesign.
const TABS: { id: AccessTab; label: string; icon: React.ElementType; ready: boolean }[] = [
  { id: 'prototype', label: 'Permissions UX', icon: Sparkles, ready: true },
  { id: 'users', label: 'User Management', icon: UserCog, ready: true },
  { id: 'builder', label: 'Permissions', icon: ShieldCheck, ready: true },
  { id: 'diff', label: 'Permission Diff', icon: GitCompare, ready: true },
  { id: 'report', label: 'Access Report', icon: FileBarChart, ready: true },
];

export const AccessView: React.FC = () => {
  const [tab, setTab] = useState<AccessTab>('users');
  const [builderDraft, setBuilderDraft] = useState<AccessPrincipalDraft | null>(null);

  const openBuilderWith = (draft: AccessPrincipalDraft) => {
    setBuilderDraft(draft);
    setTab('builder');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="access-view">
      <div className="flex items-center gap-1 border-b border-slate-800 px-4 py-2 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`access-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition ${
              tab === t.id
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.id === 'prototype' && (
              <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                Proto
              </span>
            )}
            {!t.ready && (
              <span className="ml-1 rounded bg-slate-800 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                Next
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'prototype' && <PermissionUxPrototype />}
      {tab === 'users' && <UserManagement onGrantAccess={openBuilderWith} />}
      {tab === 'builder' && (
        <PermissionBuilder
          key={
            builderDraft
              ? `${builderDraft.connectionId}:${builderDraft.principalType}:${builderDraft.principalName}`
              : 'builder'
          }
          initialDraft={builderDraft}
        />
      )}
      {tab === 'diff' && <PermissionDiff />}
      {tab === 'report' && <AccessReport />}
    </div>
  );
};
