/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database utilities as their own workspace — not a SQL Editor sidebar menu.
 * Left list keeps the e2e `utilities-*` / `sql-sidebar-utilities` testids;
 * the selected tool docks as a pane (same bodies as the old modals).
 */
import React, { useEffect, useState } from 'react';
import {
  Activity,
  Copy,
  Cpu,
  Database,
  FileSpreadsheet,
  HardDrive,
  KeyRound,
  Users,
  Wrench,
} from 'lucide-react';
import { useUiStore } from '@/app/store/uiStore';
import { FileImportsPanel } from '@/features/sql-editor/components/FileImportsPanel';
import { SQL_ICON_STROKE } from '@/shared/lib/iconStyle';
import { CloneTableModal } from './CloneTableModal';
import { DatabaseAccessModal } from './DatabaseAccessModal';
import { FileQueryModal } from './FileQueryModal';
import { IndexManagementModal } from './IndexManagementModal';
import { ServerInsightsModal, type ServerInsightsTab } from './ServerInsightsModal';

export type UtilityTool =
  | 'indexes'
  | 'dbAccess'
  | 'clone'
  | 'files'
  | 'pool'
  | 'sessions'
  | 'system'
  | 'sizes';

const LS_TOOL = 'foxschema-utilities-tool';

const TOOLS: {
  id: UtilityTool;
  testId: string;
  label: string;
  group: string;
  blurb: string;
  icon: React.ElementType;
}[] = [
  {
    id: 'indexes',
    testId: 'utilities-index-management',
    label: 'Index Management',
    group: 'Maintenance',
    blurb: 'Fragmentation, unused indexes, rebuild / reorg / drop.',
    icon: Database,
  },
  {
    id: 'clone',
    testId: 'utilities-clone-table',
    label: 'Clone Table',
    group: 'Maintenance',
    blurb: 'Archive a huge table as name_N and recreate an empty live twin.',
    icon: Copy,
  },
  {
    id: 'pool',
    testId: 'utilities-connection-pool',
    label: 'Connection Pool',
    group: 'Insights',
    blurb: 'Max, current, active, and waiting connections.',
    icon: Activity,
  },
  {
    id: 'sessions',
    testId: 'utilities-user-connections',
    label: 'User Connections',
    group: 'Insights',
    blurb: 'Who is connected and what they are running.',
    icon: Users,
  },
  {
    id: 'system',
    testId: 'utilities-system-info',
    label: 'System Info',
    group: 'Insights',
    blurb: 'CPU, RAM, storage, uptime, and server version.',
    icon: Cpu,
  },
  {
    id: 'sizes',
    testId: 'utilities-object-sizes',
    label: 'Table & Index Size',
    group: 'Insights',
    blurb: 'On-disk size plus average fragmentation per table.',
    icon: HardDrive,
  },
  {
    id: 'dbAccess',
    testId: 'utilities-database-access',
    label: 'DB users & grants',
    group: 'Access',
    blurb: 'Live principals on the connected database. GRANT still needs Grant privileges.',
    icon: KeyRound,
  },
  {
    id: 'files',
    testId: 'utilities-query-files',
    label: 'Query files',
    group: 'Files',
    blurb: 'Import CSV / JSON / text, then open a sample SELECT in SQL.',
    icon: FileSpreadsheet,
  },
];

const GROUPS = ['Maintenance', 'Insights', 'Access', 'Files'] as const;

function loadTool(): UtilityTool {
  try {
    const raw = localStorage.getItem(LS_TOOL);
    if (TOOLS.some((t) => t.id === raw)) return raw as UtilityTool;
  } catch {
    /* ignore */
  }
  return 'indexes';
}

function insightTab(tool: UtilityTool): ServerInsightsTab | null {
  if (tool === 'pool' || tool === 'sessions' || tool === 'system' || tool === 'sizes') {
    return tool;
  }
  return null;
}

export const UtilitiesView: React.FC = () => {
  const setActiveView = useUiStore((s) => s.setActiveView);
  const [tool, setTool] = useState<UtilityTool>(loadTool);
  const [fileImportsKey, setFileImportsKey] = useState(0);
  const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0]!;
  const insights = insightTab(tool);

  useEffect(() => {
    try {
      localStorage.setItem(LS_TOOL, tool);
    } catch {
      /* ignore */
    }
  }, [tool]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="utilities-view">
      <nav
        className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-800 bg-slate-950"
        aria-label="Database utilities"
        data-testid="sql-sidebar-utilities"
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5">
          <Wrench className="h-4 w-4 text-amber-400" strokeWidth={SQL_ICON_STROKE} />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Utilities</p>
            <p className="text-[10px] text-slate-500">Database, not the SQL buffer</p>
          </div>
        </div>
        {GROUPS.map((group) => (
          <div key={group} className="px-1.5 py-2">
            <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">
              {group}
            </p>
            <div className="flex flex-col gap-0.5">
              {TOOLS.filter((t) => t.group === group).map((t) => {
                const on = t.id === tool;
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={t.testId}
                    aria-current={on ? 'page' : undefined}
                    onClick={() => setTool(t.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-semibold transition ${
                      on
                        ? 'bg-slate-800 text-slate-50 ring-1 ring-amber-500/30'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-50'
                    }`}
                  >
                    <t.icon
                      className={`h-3.5 w-3.5 shrink-0 ${on ? 'text-amber-300' : 'text-amber-400/80'}`}
                      strokeWidth={SQL_ICON_STROKE}
                    />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-950">
        <header className="shrink-0 border-b border-slate-800 px-4 py-2.5">
          <h1 className="text-[13px] font-bold text-slate-100">{active.label}</h1>
          <p className="mt-0.5 text-[11px] text-slate-500">{active.blurb}</p>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tool === 'indexes' && (
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-testid="index-management-modal"
            >
              <IndexManagementModal open embedded />
            </div>
          )}
          {tool === 'clone' && (
            <CloneTableModal open embedded onClose={() => undefined} />
          )}
          {insights && (
            <ServerInsightsModal
              open
              embedded
              initialTab={insights}
              onClose={() => undefined}
            />
          )}
          {tool === 'dbAccess' && (
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-testid="db-access-modal"
            >
              <DatabaseAccessModal open embedded />
            </div>
          )}
          {tool === 'files' && (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-2">
                <FileImportsPanel
                  refreshKey={fileImportsKey}
                  onImportClick={() => undefined}
                  onUseInEditor={() => setActiveView('sqlEditor')}
                />
              </div>
              <FileQueryModal
                open
                embedded
                onClose={() => undefined}
                onImported={() => {
                  setFileImportsKey((k) => k + 1);
                  setActiveView('sqlEditor');
                }}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
