/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three questions every migration surface answers, and the tab bar that
 * asks them: what changed, what the DDL looks like, what SQL will run.
 *
 * Compare Schema had these tabs; version history grew its own trio with
 * different labels ("Blueprint / DDL / Execute") and different chrome, so the
 * same flow looked like two features. The ids and labels live here now, which
 * is what keeps them from drifting again.
 */
import React from 'react';
import { Code, FileText, GitCompareArrows } from 'lucide-react';

export type DetailTab = 'DIFF' | 'DDL_DIFF' | 'SQL';

export const DETAIL_TABS: Record<DetailTab, { label: string; icon: React.ReactElement }> = {
  DIFF: { label: 'Schema Blueprint', icon: <FileText className="w-3.5 h-3.5" /> },
  DDL_DIFF: { label: 'DDL Diff', icon: <GitCompareArrows className="w-3.5 h-3.5" /> },
  SQL: { label: 'Migration SQL', icon: <Code className="w-3.5 h-3.5" /> },
};

export interface DetailTabsProps {
  active: DetailTab;
  onSelect: (tab: DetailTab) => void;
  /** Which tabs to show. Browse mode has nothing to compare, so it shows one. */
  tabs?: readonly DetailTab[];
  /** Prefix for `data-testid`, e.g. `lokee-cmp` → `lokee-cmp-tab-SQL`. */
  testIdPrefix?: string;
  /** `compact` trims the padding for a modal pane. */
  size?: 'default' | 'compact';
}

const ALL_TABS: readonly DetailTab[] = ['DIFF', 'DDL_DIFF', 'SQL'];

export function DetailTabs({
  active,
  onSelect,
  tabs = ALL_TABS,
  testIdPrefix,
  size = 'default',
}: DetailTabsProps): React.ReactElement {
  const pad = size === 'compact' ? 'px-2 py-1' : 'px-3 py-1.5';
  return (
    <div className="flex gap-1.5">
      {tabs.map((id) => {
        const { label, icon } = DETAIL_TABS[id];
        return (
          <button
            key={id}
            type="button"
            data-testid={testIdPrefix ? `${testIdPrefix}-tab-${id}` : undefined}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-1.5 ${pad} rounded-md text-xs font-semibold transition cursor-pointer ${
              active === id
                ? 'bg-slate-850 text-slate-100 border border-slate-700/80 shadow'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            {icon} {label}
          </button>
        );
      })}
    </div>
  );
}
