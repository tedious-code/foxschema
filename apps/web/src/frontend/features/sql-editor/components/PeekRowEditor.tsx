/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Data Peek row editor — add / edit / clone form. Parent shows WriteConfirmDialog
 * before executing the generated DML.
 *
 * Each field shows its catalog type and is checked against it before the form
 * can be submitted, so a mistyped number or an over-long string is caught here
 * instead of coming back as a driver error after the write confirm. Columns the
 * engine fills in (identity / auto-increment) are locked, as are key columns
 * while editing, since those target the row.
 *
 * Date / timestamp columns use a native picker. Editable text-ish fields offer
 * Generate (string / money / email / first name / last name) so a blank insert
 * form can be filled without leaving the modal.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Lock, Sparkles, X } from 'lucide-react';
import type { TableSchema } from '@/shared/lib/types';
import {
  buildPeekFields,
  validatePeekRow,
  type PeekField,
} from '@/features/sql-editor/lib/peekRowValidation';
import {
  PEEK_GENERATORS,
  dateInputFromDraft,
  draftFromDateInput,
  generatePeekValue,
  suggestPeekGenerator,
  type PeekGeneratorId,
} from '@/features/sql-editor/lib/peekValueGenerators';
import { SQL_ICON_STROKE } from '@/shared/lib/iconStyle';

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

function FieldControl({
  field,
  value,
  showError,
  onChange,
  onBlur,
}: {
  field: PeekField;
  value: string;
  showError: boolean;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [menuOpen]);

  const inputClass = `mt-0.5 w-full rounded-md border bg-slate-950 px-2.5 py-1.5 text-[13px] font-mono text-slate-100 outline-none disabled:opacity-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
    showError ? 'border-rose-500/70 focus:border-rose-400' : 'border-slate-700 accent-focus'
  }`;

  if (field.readOnly) {
    return (
      <input
        data-testid={`peek-row-field-${field.name}`}
        value={value}
        disabled
        placeholder={field.hint}
        className={inputClass}
      />
    );
  }

  if (field.kind === 'date' || field.kind === 'timestamp') {
    const inputType = field.kind === 'date' ? 'date' : 'datetime-local';
    return (
      <input
        data-testid={`peek-row-field-${field.name}`}
        type={inputType}
        value={dateInputFromDraft(field.kind, value)}
        aria-invalid={showError || undefined}
        onChange={(e) => onChange(draftFromDateInput(field.kind as 'date' | 'timestamp', e.target.value))}
        onBlur={onBlur}
        className={inputClass}
      />
    );
  }

  const canGenerate =
    field.kind === 'text' ||
    field.kind === 'decimal' ||
    field.kind === 'other' ||
    field.kind === 'uuid';

  if (!canGenerate) {
    return (
      <input
        data-testid={`peek-row-field-${field.name}`}
        value={value}
        aria-invalid={showError || undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={field.hint}
        className={inputClass}
      />
    );
  }

  const apply = (id: PeekGeneratorId) => {
    onChange(generatePeekValue(id, field));
    setMenuOpen(false);
  };

  return (
    <div className="relative flex items-stretch gap-1" ref={menuRef}>
      <input
        data-testid={`peek-row-field-${field.name}`}
        value={value}
        aria-invalid={showError || undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={field.hint}
        className={`${inputClass} flex-1`}
      />
      <button
        type="button"
        data-testid={`peek-row-generate-${field.name}`}
        title="Generate sample value"
        aria-label={`Generate value for ${field.name}`}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        className="mt-0.5 shrink-0 rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-400 hover:text-amber-200 hover:border-amber-500/40 hover:bg-amber-500/10"
      >
        <Sparkles className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
      </button>
      {menuOpen && (
        <div
          data-testid={`peek-row-generate-menu-${field.name}`}
          className="absolute right-0 top-full z-10 mt-1 min-w-[10rem] overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-xl"
        >
          <button
            type="button"
            data-testid={`peek-row-generate-suggested-${field.name}`}
            className="block w-full px-3 py-1.5 text-left text-[11px] font-semibold text-amber-100 hover:bg-amber-500/15"
            onClick={() => apply(suggestPeekGenerator(field))}
          >
            Suggested ({PEEK_GENERATORS.find((g) => g.id === suggestPeekGenerator(field))?.label})
          </button>
          <div className="border-t border-slate-800" />
          {PEEK_GENERATORS.map((g) => (
            <button
              key={g.id}
              type="button"
              data-testid={`peek-row-generate-${g.id}-${field.name}`}
              className="block w-full px-3 py-1.5 text-left text-[11px] font-medium text-slate-200 hover:bg-slate-800"
              onClick={() => apply(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  // Only show a field's error once it has been touched or a submit attempted —
  // every NOT NULL column is "invalid" the moment an empty form opens.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(initialDraft);
      setTouched({});
      setSubmitAttempted(false);
    }
  }, [open, initialDraft]);

  // Escape closes, same as clicking the backdrop.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onCancel]);

  const fields = useMemo(
    () => buildPeekFields({ mode, columns, table, keyNames, identityColumns }),
    [mode, columns, table, keyNames, identityColumns]
  );

  const errors = useMemo(() => validatePeekRow(fields, draft), [fields, draft]);
  const errorCount = Object.keys(errors).length;

  const generateFillable = () => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        if (f.readOnly) continue;
        if (f.kind === 'date' || f.kind === 'timestamp' || f.kind === 'boolean' || f.kind === 'integer') {
          continue;
        }
        if (
          f.kind === 'text' ||
          f.kind === 'decimal' ||
          f.kind === 'other' ||
          f.kind === 'uuid'
        ) {
          next[f.name] = generatePeekValue(suggestPeekGenerator(f), f);
        }
      }
      return next;
    });
  };

  if (!open) return null;

  const submit = () => {
    setSubmitAttempted(true);
    if (errorCount > 0) return;
    onSubmit(draft);
  };

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
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/50 px-4 py-3 shrink-0 gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-100">{TITLES[mode]}</h2>
            <p className="text-[11px] text-slate-500 truncate font-mono">{tableName}</p>
          </div>
          {(mode === 'add' || mode === 'clone') && (
            <button
              type="button"
              data-testid="peek-row-generate-all"
              onClick={generateFillable}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-100"
              title="Fill editable text / money / name fields with sample data"
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
              Generate
            </button>
          )}
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
            const error = errors[f.name];
            const showError = Boolean(error) && (submitAttempted || touched[f.name]);
            return (
              <label key={f.name} className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  {f.name}
                  {f.isKey && <span className="text-amber-400/80 normal-case">PK</span>}
                  {f.isIdentity && (
                    <span className="text-sky-400/80 normal-case font-semibold">identity</span>
                  )}
                  {!f.nullable && !f.readOnly && <span className="text-rose-400/80">*</span>}
                  {f.readOnly && (
                    <Lock className="w-3 h-3 text-slate-600" strokeWidth={SQL_ICON_STROKE} />
                  )}
                  <span className="ml-auto normal-case font-mono text-[10px] text-slate-600">
                    {f.type}
                  </span>
                </span>
                <FieldControl
                  field={f}
                  value={draft[f.name] ?? ''}
                  showError={showError}
                  onChange={(next) => setDraft((d) => ({ ...d, [f.name]: next }))}
                  onBlur={() => setTouched((t) => ({ ...t, [f.name]: true }))}
                />
                {showError && (
                  <span
                    data-testid={`peek-row-error-${f.name}`}
                    className="mt-0.5 block text-[10px] font-semibold text-rose-300"
                  >
                    {error}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-4 py-3 shrink-0">
          {submitAttempted && errorCount > 0 && (
            <span
              data-testid="peek-row-error-summary"
              className="mr-auto flex items-center gap-1.5 text-[11px] font-semibold text-rose-300"
            >
              <AlertTriangle className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
              {errorCount} field{errorCount === 1 ? '' : 's'} need fixing
            </span>
          )}
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
            onClick={submit}
            // Deliberately not disabled: clicking with errors is how the user
            // finds out which fields are wrong. A dead button would only look
            // broken.
            title={errorCount > 0 ? 'Fix the highlighted fields first' : undefined}
            className={`px-3 py-1.5 text-xs font-bold rounded-md border ${
              errorCount > 0
                ? 'border-slate-700 bg-slate-800/60 text-slate-500'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
            }`}
          >
            {mode === 'edit' ? 'Save changes' : mode === 'clone' ? 'Insert clone' : 'Insert row'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
