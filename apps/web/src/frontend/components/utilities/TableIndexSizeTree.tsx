/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Grouped table → index size tree used by Server Insights.
 * Click a table row to expand/collapse its indexes. Frozen column headers.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  filterTableSizeGroups,
  formatBytes,
  formatRowCount,
  groupObjectSizes,
  type ObjectSizeRow,
  type TableSizeGroup,
} from '@foxschema/sql';

interface Props {
  rows: ObjectSizeRow[];
  filter: string;
}

export const TableIndexSizeTree: React.FC<Props> = ({ rows, filter }) => {
  const groups = useMemo(
    () => filterTableSizeGroups(groupObjectSizes(rows), filter),
    [rows, filter]
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const groupKey = (g: TableSizeGroup) =>
    `${g.schemaName ?? ''}::${g.tableName}`;

  const groupedKey = groups.map(groupKey).join('\0');

  useEffect(() => {
    if (!filter.trim()) return;
    setExpanded(new Set(groupedKey.split('\0').filter(Boolean)));
  }, [filter, groupedKey]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-slate-500" data-testid="server-insights-size-empty">
        No size rows returned.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex flex-wrap gap-2 shrink-0">
        <button
          type="button"
          data-testid="server-insights-size-expand-all"
          onClick={() => setExpanded(new Set(groups.map(groupKey)))}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-md border border-slate-600 text-slate-200 hover:bg-slate-800"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Expand tables
        </button>
        <button
          type="button"
          data-testid="server-insights-size-collapse-all"
          onClick={() => setExpanded(new Set())}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-md border border-slate-600 text-slate-200 hover:bg-slate-800"
        >
          <ChevronRight className="w-3.5 h-3.5" />
          Collapse tables
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-700">
        <table className="min-w-full text-left text-[12px] border-collapse" data-testid="server-insights-size-groups">
          <thead className="sticky top-0 z-10">
            <tr
              className="bg-slate-950 text-[10px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-800 shadow-[0_1px_0_0_rgb(30_41_59)]"
              data-testid="server-insights-size-header"
            >
              <th className="w-8 px-2 py-2 font-bold" aria-label="Expand" />
              <th className="px-3 py-2 font-bold">Table / index</th>
              <th className="px-3 py-2 font-bold text-right w-28">Rows</th>
              <th className="px-3 py-2 font-bold text-right w-28">Data</th>
              <th className="px-3 py-2 font-bold text-right w-28">Index size</th>
              <th className="px-3 py-2 font-bold text-right w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const key = groupKey(group);
              const open = expanded.has(key);
              return (
                <React.Fragment key={key}>
                  <tr
                    className="bg-slate-900/90 border-y border-slate-800 cursor-pointer"
                    data-testid={`server-insights-size-group-${group.tableName}`}
                    data-expanded={open ? 'true' : 'false'}
                    onClick={() => toggle(key)}
                  >
                    <td className="px-2 py-1.5">
                      <span className="text-slate-400" aria-hidden>
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-sky-400" />
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-semibold text-slate-100 truncate">
                          {group.schemaName ? `${group.schemaName}.` : ''}
                          {group.tableName}
                        </span>
                        <span className="text-[11px] text-slate-500 shrink-0">
                          {group.indexes.length} index{group.indexes.length === 1 ? '' : 'es'}
                        </span>
                      </div>
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-100"
                      data-testid={`server-insights-size-rows-${group.tableName}`}
                    >
                      {formatRowCount(group.rowCount)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums text-slate-200"
                      data-testid={`server-insights-size-data-${group.tableName}`}
                    >
                      {formatBytes(group.dataBytes)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums text-slate-200"
                      data-testid={`server-insights-size-index-${group.tableName}`}
                    >
                      {formatBytes(group.indexBytes)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                      {formatBytes(group.totalBytes)}
                    </td>
                  </tr>
                  {open &&
                    (group.indexes.length === 0 ? (
                      <tr className="bg-slate-950/40 border-b border-slate-800/70">
                        <td />
                        <td
                          colSpan={5}
                          className="px-3 py-1.5 text-[11px] italic text-slate-600"
                          data-testid={`server-insights-size-indexes-${group.tableName}`}
                        >
                          No per-index sizes for this dialect — table totals still include index
                          storage.
                        </td>
                      </tr>
                    ) : (
                      group.indexes.map((idx) => (
                        <IndexSizeRow
                          key={`${idx.schemaName}-${idx.objectName}`}
                          tableName={group.tableName}
                          idx={idx}
                        />
                      ))
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function IndexSizeRow({ tableName, idx }: { tableName: string; idx: ObjectSizeRow }) {
  return (
    <tr
      className="bg-slate-950/40 border-b border-slate-800/70 text-[12px]"
      data-testid={`server-insights-size-index-row-${tableName}-${idx.objectName}`}
    >
      <td />
      <td className="pl-10 pr-3 py-1.5 font-mono text-slate-300 truncate">{idx.objectName}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
        {formatRowCount(idx.rowCount)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">—</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-200">
        {formatBytes(idx.indexBytes ?? idx.totalBytes)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
        {formatBytes(idx.totalBytes)}
      </td>
    </tr>
  );
}
