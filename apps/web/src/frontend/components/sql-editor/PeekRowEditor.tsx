/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Data Peek row editor — add / edit / clone form. Parent shows WriteConfirmDialog
 * before executing the generated DML.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { TableSchema } from '../../lib/types';
import { SQL_ICON_STROKE } from './sqlIconStyle';

export type PeekRowEditorMode = 'add' | 'edit' | 'clone';

interface Props {
  open: boolean;
  mode: PeekRowEditorMode;
  tableName: string;
  table: TableSchema;
  columns: string[];
  /** Initial field values (stringified for inputs). */
  draft: Record<string, string>;
  /** Key column names — shown read-only in edit mode. */
  keyNames: string[];
  identityColumns: Set<string>;
  onCancel: () => void;
  onSubmit: (draft: Record<string, string>) => void;
}

const TITLES: Record<PeekRowEditorMode, string> = {
  add: 'Add row',
  edit: 'Edit row',
  clone: 'Clone row',
};

export const PeekRowEditor: React.FC<Props> = ({
  open,
  mode,
  tableName,
  table,
  columns,
  draft: initialDraft,
  keyNames,
  identityColumns,
  onCancel,
  onSubmit,
}) => {
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    if (open) setDraft(initialDraft);
  }, [open, initialDraft]);

  const keyLower = useMemo(() => new Set(keyNames.map((k) => k.toLowerCase())), [keyNames]);

  const fields = useMemo(() => {
    return columns.map((name) => {
      const meta = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
      return {
        name,
        type: meta?.type ?? '',
        nullable: meta?.nullable ?? true,
        isKey: keyLower.has(name.toLowerCase()),
        isIdentity: identityColumns.has(name) || Boolean(meta?.identity),
      };
    });
  }, [columns, table.columns, keyLower, identityColumns]);

  if (!open) return null;

  return createPortal(
    <div
      data-testid="peek-row-editor"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/50 px-4 py-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-100">{TITLES[mode]}</h2>
            <p className="text-[11px] text-slate-500 truncate font-mono">{tableName}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={SQL_ICON_STROKE} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {fields.map((f) => {
            const readOnly = mode === 'edit' && f.isKey;
            const hint =
              mode !== 'edit' && f.isIdentity
                ? 'Leave blank for auto-generated'
                : f.isKey
                  ? 'Primary key'
                  : f.type;
            return (
              <label key={f.name} className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  {f.name}
                  {f.isKey && <span className="text-amber-400/80 normal-case">PK</span>}
                  {!f.nullable && <span className="text-rose-400/80">*</span>}
                </span>
                <input
                  data-testid={`peek-row-field-${f.name}`}
                  value={draft[f.name] ?? ''}
                  disabled={readOnly}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
                  placeholder={hint}
                  className="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[13px] font-mono text-slate-100 outline-none focus:border-amber-500 disabled:opacity-50 disabled:text-slate-500"
                />
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-4 py-3 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="peek-row-submit"
            onClick={() => onSubmit(draft)}
            className="px-3 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
          >
            {mode === 'edit' ? 'Save changes' : mode === 'clone' ? 'Insert clone' : 'Insert row'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
