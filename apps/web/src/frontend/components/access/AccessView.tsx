import React, { useState } from 'react';
import { ShieldCheck, SearchCheck, FileBarChart } from 'lucide-react';
import { PermissionBuilder } from './PermissionBuilder';
import { PermissionInspector } from './PermissionInspector';

export type AccessTab = 'builder' | 'inspector' | 'report';

const TABS: { id: AccessTab; label: string; icon: React.ElementType; ready: boolean }[] = [
  { id: 'builder', label: 'Permission Builder', icon: ShieldCheck, ready: true },
  { id: 'inspector', label: 'Permission Inspector', icon: SearchCheck, ready: true },
  { id: 'report', label: 'Access Report', icon: FileBarChart, ready: false },
];

/**
 * Database Access Assistant.
 *
 * Fox Schema builds and explains permission SQL; it is deliberately not an IAM
 * system. It does not create accounts, hold credentials, or apply access
 * changes — the database remains the source of truth.
 */
export const AccessView: React.FC = () => {
  const [tab, setTab] = useState<AccessTab>('builder');

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
            {!t.ready && (
              <span className="ml-1 rounded bg-slate-800 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                Next
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'builder' && <PermissionBuilder />}
      {tab === 'inspector' && <PermissionInspector />}

      {tab === 'report' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <p className="text-sm font-bold text-slate-300">
              {TABS.find((t) => t.id === tab)?.label}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Aggregates access across every principal, with risk findings and “who can reach this
              table?”. Builds on the inspector’s effective-permission resolution.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
