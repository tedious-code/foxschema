/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The diff tree, grouped by object type — shared by every comparison.
 *
 * Extracted from `SchemaTreePanel`, which reads nineteen fields straight out of
 * `useSyncStore` and mixes migrate controls into the same component. That made
 * it unusable anywhere but the live workspace: rendering it for two *stored*
 * versions would have clobbered the user's in-flight comparison.
 *
 * This half takes props only. `SchemaTreePanel` keeps the store wiring, the
 * filter chrome and the deploy controls and passes the result down; the version
 * history renders the same tree for two points in the past. One component, two
 * sources of data.
 *
 * Selection is optional on purpose. The workspace uses it to pick objects to
 * deploy; history uses the identical mechanism to pick objects to revert. Those
 * are the same gesture over the same shape, so they are the same code.
 */
import React, { useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  FunctionSquare,
  Hash,
  Layers,
  SquareTerminal,
  Table2,
  Users,
  Zap,
} from 'lucide-react';
import type { IndexDiff, TableDiff, DbObjectType } from '@/shared/lib/types';
import { highlightMatch } from '@/shared/utils/highlight';

export interface TypeMeta {
  icon: React.ReactElement;
  group: string;
  color: string;
}

/**
 * Icon, plural label and colour per object type.
 *
 * Exported because `TopToolbar` renders the same pills with counts — that bar
 * has the horizontal room this panel's narrow, resizable width does not.
 */
export const TYPE_META: Record<DbObjectType, TypeMeta> = {
  TABLE: { icon: <Table2 className="w-3.5 h-3.5 text-cyan-400" />, group: 'Tables', color: 'text-cyan-400' },
  MQT: { icon: <Layers className="w-3.5 h-3.5 text-teal-400" />, group: 'MQTs', color: 'text-teal-400' },
  VIEW: { icon: <Eye className="w-3.5 h-3.5 text-purple-400" />, group: 'Views', color: 'text-purple-400' },
  FUNCTION: {
    icon: <FunctionSquare className="w-3.5 h-3.5 text-amber-400" />,
    group: 'Functions',
    color: 'text-amber-400',
  },
  PROCEDURE: {
    icon: <SquareTerminal className="w-3.5 h-3.5 text-orange-400" />,
    group: 'Procedures',
    color: 'text-orange-400',
  },
  TRIGGER: { icon: <Zap className="w-3.5 h-3.5 text-rose-400" />, group: 'Triggers', color: 'text-rose-400' },
  SEQUENCE: { icon: <Hash className="w-3.5 h-3.5 text-sky-400" />, group: 'Sequences', color: 'text-sky-400' },
  TYPE: { icon: <Box className="w-3.5 h-3.5 text-indigo-400" />, group: 'Types', color: 'text-indigo-400' },
  ROLE: { icon: <Users className="w-3.5 h-3.5 text-pink-400" />, group: 'Roles', color: 'text-pink-400' },
};

/** Display order of the groups. Tables first — that is what people look for. */
export const TYPE_ORDER: DbObjectType[] = [
  'TABLE',
  'MQT',
  'VIEW',
  'FUNCTION',
  'PROCEDURE',
  'TRIGGER',
  'SEQUENCE',
  'TYPE',
  'ROLE',
];

export function statusBadgeClass(status: TableDiff['status']): string {
  switch (status) {
    case 'ADDED':
      return 'bg-emerald-950/60 text-emerald-400 border-emerald-500/20';
    case 'REMOVED':
      return 'bg-rose-950/60 text-rose-400 border-rose-500/20';
    case 'MODIFIED':
      return 'bg-amber-950/60 text-amber-400 border-amber-500/20';
    default:
      return 'bg-slate-900/60 text-slate-500 border-slate-700/30';
  }
}

/**
 * Where a search matched, when it did not match the object's own name.
 *
 * Without this a search for a column name lists tables whose names look
 * unrelated, and the reader cannot tell why any of them are there.
 */
export function matchLocationOf(table: TableDiff, query: string): string | null {
  if (!query || table.tableName.toLowerCase().includes(query)) return null;
  const col = table.columnDiffs.find((c) => c.name.toLowerCase().includes(query));
  if (col) return `column: ${col.name}`;
  const idx = table.indexDiffs.find((i) => i.name.toLowerCase().includes(query));
  if (idx) return `index: ${idx.name}`;
  const fk = table.foreignKeyDiffs.find((f) => f.name.toLowerCase().includes(query));
  if (fk) return `foreign key: ${fk.name}`;
  const trg = (table.triggerDiffs ?? []).find((t) => t.name.toLowerCase().includes(query));
  if (trg) return `trigger: ${trg.name}`;
  return 'definition';
}

/**
 * Tables in the order the tree draws them — grouped by type, tables first.
 *
 * Callers that pair the tree with a detail pane need this: the raw array order
 * is not the display order, so defaulting a selection to `tables[0]` picks a
 * row that is not the one at the top of the list.
 */
export function orderTablesForDisplay(tables: readonly TableDiff[]): TableDiff[] {
  return TYPE_ORDER.flatMap((type) => tables.filter((t) => t.objectType === type));
}

export interface SchemaDiffTreeProps {
  /** Already filtered by the caller — this component does not decide what to show. */
  tables: TableDiff[];
  selectedName?: string | null;
  onSelect?: (table: TableDiff) => void;
  /** Search term, lower-cased, for match highlighting. */
  query?: string;
  /** Browse mode has only UNCHANGED rows, so the badge is noise. */
  showStatusBadge?: boolean;
  /**
   * Per-object tick state. Present means checkboxes render — the workspace uses
   * it for "deploy this", history for "revert this".
   */
  selection?: Record<string, boolean>;
  onToggleSelection?: (tableName: string) => void;
  /** Tooltip on the checkbox; the two callers mean different things by it. */
  selectionTitle?: string;
  emptyMessage?: string;
}

function tableCanNestIndexes(table: TableDiff): boolean {
  return table.objectType === 'TABLE' || table.objectType === 'MQT' || table.objectType === 'VIEW';
}

function indexDisplayName(idx: IndexDiff): string {
  return idx.source?.name || idx.target?.name || idx.name;
}

function indexInfo(idx: IndexDiff): { columns: string[]; unique: boolean } | null {
  const info = idx.source || idx.target;
  if (!info) return null;
  return { columns: info.columns ?? [], unique: !!info.unique };
}

export function SchemaDiffTree({
  tables,
  selectedName,
  onSelect,
  query = '',
  showStatusBadge = true,
  selection,
  onToggleSelection,
  selectionTitle = 'Include this change',
  emptyMessage = 'No matching schema objects.',
}: SchemaDiffTreeProps): React.ReactElement {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (tableName: string) => {
    setExpanded((prev) => ({ ...prev, [tableName]: !prev[tableName] }));
  };

  const groups = TYPE_ORDER.map((type) => ({
    type,
    items: tables.filter((t) => t.objectType === type),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <div className="text-center py-8 text-slate-600 text-sm">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.type}>
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1 sticky top-0 z-[1] bg-slate-950/95">
            {TYPE_META[group.type].icon}
            <span
              className={`text-xs font-bold uppercase tracking-wider ${TYPE_META[group.type].color}`}
            >
              {TYPE_META[group.type].group}
            </span>
            <span className="text-xs text-slate-600 font-mono">({group.items.length})</span>
            <div className="flex-1 h-px bg-slate-800/80" />
          </div>

          <div className="space-y-1">
            {group.items.map((table) => {
              const isSelected = selectedName === table.tableName;
              const matchedIn = matchLocationOf(table, query);
              const nestIndexes = tableCanNestIndexes(table);
              const isOpen = !!expanded[table.tableName];
              const indexes = table.indexDiffs ?? [];
              return (
                <div
                  key={table.tableName}
                  data-testid="diff-item"
                  data-object={table.tableName}
                  data-status={table.status}
                  data-expanded={nestIndexes ? (isOpen ? 'true' : 'false') : undefined}
                  onClick={() => {
                    onSelect?.(table);
                    if (nestIndexes && !isOpen) toggleExpand(table.tableName);
                  }}
                  className={`rounded-lg border transition ${
                    onSelect || nestIndexes ? 'cursor-pointer' : ''
                  } ${
                    isSelected
                      ? 'bg-slate-800/80 border-slate-700/80 shadow-md shadow-indigo-500/5'
                      : 'bg-slate-950/30 border-transparent hover:border-slate-800/80 hover:bg-slate-900/40'
                  }`}
                >
                  <div className="group flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {nestIndexes ? (
                        <button
                          type="button"
                          data-testid={`diff-item-expand-${table.tableName}`}
                          aria-label={isOpen ? `Collapse ${table.tableName}` : `Expand ${table.tableName}`}
                          aria-expanded={isOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(table.tableName);
                          }}
                          className="p-0.5 text-slate-400 hover:text-slate-100 shrink-0"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-sky-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-sky-400" />
                          )}
                        </button>
                      ) : selection && table.status !== 'UNCHANGED' ? null : (
                        <span className="w-5 shrink-0" />
                      )}
                      {selection && table.status !== 'UNCHANGED' ? (
                        <input
                          type="checkbox"
                          checked={!!selection[table.tableName]}
                          onChange={() => onToggleSelection?.(table.tableName)}
                          onClick={(e) => e.stopPropagation()}
                          title={selectionTitle}
                          className="w-4 h-4 accent-cyan-500 cursor-pointer shrink-0"
                        />
                      ) : nestIndexes ? null : (
                        <span className="w-4 shrink-0" />
                      )}
                      <span className="shrink-0">{TYPE_META[table.objectType].icon}</span>
                      <div className="flex flex-col min-w-0">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isSelected ? 'text-slate-100' : 'text-slate-300 group-hover:text-slate-200'
                          }`}
                        >
                          {highlightMatch(table.tableName, query)}
                        </span>
                        {matchedIn && (
                          <span
                            className="text-[10px] text-slate-500 truncate"
                            title={`Search matched in ${matchedIn}`}
                          >
                            matched in {matchedIn}
                          </span>
                        )}
                      </div>
                      {nestIndexes && (
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {indexes.length} idx
                        </span>
                      )}
                    </div>

                    {showStatusBadge && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ml-2 ${statusBadgeClass(
                          table.status
                        )}`}
                      >
                        {table.status}
                      </span>
                    )}
                  </div>
                  {nestIndexes && isOpen && (
                    <ul
                      className="border-t border-slate-800/80 px-2.5 py-1.5 ml-6 mb-1.5 space-y-0.5"
                      data-testid={`diff-item-indexes-${table.tableName}`}
                    >
                      <li className="text-[10px] font-bold uppercase tracking-wide text-indigo-400/90 pb-0.5">
                        Indexes
                      </li>
                      {indexes.length === 0 ? (
                        <li className="text-[11px] text-slate-600 italic">No indexes</li>
                      ) : (
                        indexes.map((idx) => {
                          const info = indexInfo(idx);
                          const label = indexDisplayName(idx);
                          return (
                            <li
                              key={idx.name}
                              className="text-[12px] font-mono text-slate-300 truncate"
                              data-testid={`diff-item-index-${table.tableName}-${idx.name}`}
                            >
                              <span className="font-semibold">{highlightMatch(label, query)}</span>
                              {info ? (
                                <>
                                  <span className="ml-1.5 text-[10px] font-bold uppercase font-sans text-indigo-300/80">
                                    {info.unique ? 'unique' : 'non-unique'}
                                  </span>
                                  {info.columns.length > 0 ? (
                                    <span className="text-slate-500 ml-1.5 font-sans text-[11px]">
                                      ({info.columns.join(', ')})
                                    </span>
                                  ) : null}
                                </>
                              ) : null}
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
