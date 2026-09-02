/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The object × privilege grid.
 *
 * The flat builder answers "one permission set, one scope", so a realistic
 * grant — read four tables, write one, run two procedures — is four passes
 * through the form and four separate blocks of SQL to reconcile by hand. Here
 * the whole answer is one screen: rows are objects, columns are privileges, and
 * the SQL is compiled from the ticks.
 *
 * Cells an engine cannot express are drawn and disabled rather than hidden,
 * carrying the reason on hover. Hiding them makes the grid look uniform across
 * engines that are not, and sends the reader looking for a checkbox that was
 * never there; "PostgreSQL has no GRANT for this — changing an object requires
 * owning it" answers the question they actually have.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, Table2, Eye, Cog, FunctionSquare, Info } from 'lucide-react';
import {
  cellSupport,
  compileObjectGrid,
  describePermission,
  gridColumnsFor,
  type AccessPermission,
  type AccessPrincipal,
  type GridObjectKind,
  type GridRow,
  type PermissionRequest,
} from '../lib/access';
import { Autocomplete } from '@/shared/components/Autocomplete';
import { inputCls } from './controls';

/** A row plus the identity the list needs to keep inputs stable while editing. */
interface MatrixRow extends GridRow {
  id: string;
}

const KIND_META: Record<
  GridObjectKind,
  { label: string; plural: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  table: { label: 'Table', plural: 'Tables', Icon: Table2 },
  view: { label: 'View', plural: 'Views', Icon: Eye },
  procedure: { label: 'Procedure', plural: 'Procedures', Icon: Cog },
  function: { label: 'Function', plural: 'Functions', Icon: FunctionSquare },
};

/**
 * Short column headings.
 *
 * The full label lives in `describePermission` and reaches the reader through
 * the header's tooltip; a grid nine columns wide has room for a word.
 */
const COLUMN_LABEL: Partial<Record<AccessPermission, string>> = {
  read: 'Select',
  insert: 'Insert',
  update: 'Update',
  delete: 'Delete',
  reference: 'Refs',
  'index-object': 'Index',
  'trigger-object': 'Trigger',
  'alter-object': 'Alter',
  'drop-object': 'Drop',
  'execute-procedure': 'Execute',
  'execute-function': 'Execute',
};

/**
 * Which band a column sits under.
 *
 * DML changes rows, DDL changes the object. Splitting them is what makes a wide
 * grid scannable: the two halves carry very different consequences, and the
 * reader is usually looking for one or the other.
 */
function bandOf(permission: AccessPermission): 'DML' | 'DDL' {
  return permission === 'read' ||
    permission === 'insert' ||
    permission === 'update' ||
    permission === 'delete' ||
    permission === 'execute-procedure' ||
    permission === 'execute-function'
    ? 'DML'
    : 'DDL';
}

let rowSeq = 0;
const newRow = (kind: GridObjectKind, schema?: string): MatrixRow => ({
  id: `row-${++rowSeq}`,
  kind,
  name: '',
  schema,
  permissions: [],
});

export const PermissionMatrix: React.FC<{
  dialect: string;
  principal: AccessPrincipal;
  action: 'grant' | 'revoke' | 'deny';
  schema: string;
  withGrantOption?: boolean;
  /** Table names for the row autocomplete, already scoped to `schema`. */
  tableChoices?: readonly string[];
  /** Called whenever the ticks change, with the requests they compile to. */
  onChange?: (requests: PermissionRequest[]) => void;
}> = ({
  dialect,
  principal,
  action,
  schema,
  withGrantOption,
  tableChoices = [],
  onChange,
}) => {
  const [rows, setRows] = useState<MatrixRow[]>(() => [newRow('table')]);

  // Keyed on the principal's *fields*, never its object identity. The parent
  // builds `principal` as a literal in its JSX, so a fresh object arrives on
  // every render; keying on identity made this memo recompute each time, which
  // fired the effect below, which set parent state, which re-rendered, which
  // produced another fresh object. The panel died with "Maximum update depth
  // exceeded" the moment it was opened.
  //
  // Depending on the fields makes the component safe however it is called,
  // rather than making correctness the caller's job to remember.
  const principalType = principal.type;
  const principalName = principal.name;
  const requests = useMemo(
    () =>
      compileObjectGrid(rows, {
        dialect,
        principal: { type: principalType, name: principalName },
        action,
        schema,
        withGrantOption,
      }),
    [rows, dialect, principalType, principalName, action, schema, withGrantOption]
  );

  // `onChange` is called from an effect rather than from the click handlers so
  // that every path that mutates rows reports, including the bulk toggles.
  React.useEffect(() => {
    onChange?.(requests);
  }, [requests, onChange]);

  const update = useCallback((id: string, patch: Partial<MatrixRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const toggle = useCallback(
    (id: string, permission: AccessPermission) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const has = r.permissions.includes(permission);
          return {
            ...r,
            permissions: has
              ? r.permissions.filter((p) => p !== permission)
              : [...r.permissions, permission],
          };
        })
      );
    },
    []
  );

  /** Tick or clear every available cell in one row — the common bulk action. */
  const toggleRow = useCallback(
    (id: string) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const available = gridColumnsFor(dialect, r.kind)
            .filter((c) => c.support.available)
            .map((c) => c.permission);
          const allOn = available.length > 0 && available.every((p) => r.permissions.includes(p));
          return { ...r, permissions: allOn ? [] : available };
        })
      );
    },
    [dialect]
  );

  /** Tick or clear one column across every row of that kind. */
  const toggleColumn = useCallback(
    (kind: GridObjectKind, permission: AccessPermission) => {
      if (!cellSupport(dialect, kind, permission).available) return;
      setRows((prev) => {
        const inKind = prev.filter((r) => r.kind === kind);
        const allOn =
          inKind.length > 0 && inKind.every((r) => r.permissions.includes(permission));
        return prev.map((r) => {
          if (r.kind !== kind) return r;
          const has = r.permissions.includes(permission);
          if (allOn && has) return { ...r, permissions: r.permissions.filter((p) => p !== permission) };
          if (!allOn && !has) return { ...r, permissions: [...r.permissions, permission] };
          return r;
        });
      });
    },
    [dialect]
  );

  const kinds = useMemo(() => {
    const present = new Set(rows.map((r) => r.kind));
    return (['table', 'view', 'procedure', 'function'] as const).filter((k) => present.has(k));
  }, [rows]);

  const ticked = rows.reduce((n, r) => n + r.permissions.length, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="permission-matrix">
      {kinds.map((kind) => {
        const columns = gridColumnsFor(dialect, kind);
        const kindRows = rows.filter((r) => r.kind === kind);
        const meta = KIND_META[kind];
        const bands = columns.reduce<{ band: 'DML' | 'DDL'; span: number }[]>((acc, c) => {
          const band = bandOf(c.permission);
          const last = acc[acc.length - 1];
          if (last && last.band === band) last.span += 1;
          else acc.push({ band, span: 1 });
          return acc;
        }, []);

        return (
          <div
            key={kind}
            data-testid={`matrix-section-${kind}`}
            className="rounded-lg border border-slate-800 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/60 border-b border-slate-800">
              <meta.Icon className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
                {meta.plural}
              </span>
              <span className="text-[11px] text-slate-500">{kindRows.length}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left font-normal px-3 py-1.5 w-[38%]">Name</th>
                    {bands.map((b, i) => (
                      <th
                        key={`${b.band}-${i}`}
                        colSpan={b.span}
                        className={`px-2 py-1.5 font-bold uppercase tracking-wide text-[10px] border-l border-slate-800 ${
                          b.band === 'DDL' ? 'text-amber-500/70' : 'text-slate-500'
                        }`}
                      >
                        {b.band}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="text-left font-normal px-3 pb-1.5">
                      <button
                        type="button"
                        onClick={() => setRows((p) => [...p, newRow(kind, schema)])}
                        data-testid={`matrix-add-${kind}`}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        <Plus className="w-3 h-3" />
                        Add {meta.label.toLowerCase()}
                      </button>
                    </th>
                    {columns.map(({ permission, support }) => {
                      const descriptor = describePermission(permission);
                      return (
                        <th
                          key={permission}
                          className="px-1 pb-1.5 font-normal border-l border-slate-800/60"
                        >
                          <button
                            type="button"
                            disabled={!support.available}
                            onClick={() => toggleColumn(kind, permission)}
                            data-testid={`matrix-col-${kind}-${permission}`}
                            title={
                              support.available
                                ? `${descriptor.label} (${descriptor.privilegeHint}) — click to tick every row`
                                : support.reason
                            }
                            className={
                              support.available
                                ? 'w-full text-[10px] hover:text-slate-100'
                                : 'w-full text-[10px] text-slate-600 line-through cursor-not-allowed'
                            }
                          >
                            {COLUMN_LABEL[permission] ?? descriptor.label}
                          </button>
                        </th>
                      );
                    })}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {kindRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800/50 last:border-0">
                      <td className="px-3 py-1">
                        {kind === 'table' || kind === 'view' ? (
                          <Autocomplete
                            value={row.name}
                            onChange={(v) => update(row.id, { name: v })}
                            options={tableChoices.map((t) => ({ value: t, label: t }))}
                            placeholder={`${meta.label} name`}
                            data-testid={`matrix-name-${row.id}`}
                          />
                        ) : (
                          <input
                            className={inputCls}
                            value={row.name}
                            onChange={(e) => update(row.id, { name: e.target.value })}
                            placeholder={`${meta.label} name`}
                            data-testid={`matrix-name-${row.id}`}
                          />
                        )}
                      </td>
                      {columns.map(({ permission, support }) => {
                        const on = row.permissions.includes(permission);
                        return (
                          <td
                            key={permission}
                            className="text-center border-l border-slate-800/40 px-1"
                          >
                            <input
                              type="checkbox"
                              checked={on && support.available}
                              disabled={!support.available}
                              onChange={() => toggle(row.id, permission)}
                              title={support.available ? undefined : support.reason}
                              data-testid={`matrix-cell-${row.id}-${permission}`}
                              className={
                                support.available
                                  ? 'accent-emerald-500 cursor-pointer'
                                  : 'opacity-25 cursor-not-allowed'
                              }
                            />
                          </td>
                        );
                      })}
                      <td className="px-1 text-right">
                        <button
                          type="button"
                          onClick={() => setRows((p) => p.filter((r) => r.id !== row.id))}
                          title="Remove this row"
                          data-testid={`matrix-remove-${row.id}`}
                          className="text-slate-600 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {kindRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={columns.length + 2}
                        className="px-3 py-3 text-center text-slate-600"
                      >
                        No {meta.plural.toLowerCase()} yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 px-3 py-1.5 border-t border-slate-800 bg-slate-950/40">
              {kindRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => toggleRow(row.id)}
                  data-testid={`matrix-row-all-${row.id}`}
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                >
                  All / none: {row.name || '(unnamed)'}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {(['view', 'procedure', 'function'] as const)
          .filter((k) => !kinds.includes(k))
          .map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setRows((p) => [...p, newRow(k, schema)])}
              data-testid={`matrix-add-section-${k}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-[11px] text-slate-400 hover:text-slate-200"
            >
              <Plus className="w-3 h-3" />
              {KIND_META[k].plural}
            </button>
          ))}
      </div>

      <div
        data-testid="matrix-summary"
        className="flex items-start gap-2 text-[11px] text-slate-500"
      >
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          {ticked === 0
            ? 'Tick the privileges each object needs. Struck-through columns are ones this engine cannot grant on a single object — hover for why.'
            : `${ticked} privilege${ticked === 1 ? '' : 's'} ticked, compiled into ${
                requests.length
              } statement group${requests.length === 1 ? '' : 's'}. Objects sharing a privilege set are granted together.`}
        </span>
      </div>
    </div>
  );
};
