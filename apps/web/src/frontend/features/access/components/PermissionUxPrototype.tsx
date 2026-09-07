/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive UX prototype for Database Access permissions.
 *
 * Mock catalog + existing grants only — no SQL is executed. Review this flow
 * before wiring it into PermissionBuilder / DatabaseAccessModal.
 */
import React, { useMemo, useState } from 'react';
import {
  Cog,
  Eye,
  FunctionSquare,
  KeyRound,
  Pencil,
  Plus,
  ShieldAlert,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { Segmented, inputCls, labelCls } from './controls';

type ObjectKind = 'table' | 'view' | 'procedure' | 'function';
type ActionMode = 'grant' | 'revoke';
type PanelMode = 'browse' | 'create' | 'edit';

interface CatalogObject {
  kind: ObjectKind;
  schema: string;
  name: string;
}

interface PrivilegeRow {
  id: string;
  kind: ObjectKind | 'schema' | 'database';
  schema: string | null;
  name: string;
  dml: string[];
  ddl: string[];
}

const DML_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE'] as const;
const DDL_PRIVS = ['CREATE', 'ALTER', 'DROP', 'REFERENCES', 'TRIGGER', 'INDEX'] as const;

const KIND_META: Record<
  ObjectKind,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  table: { label: 'Tables', Icon: Table2 },
  view: { label: 'Views', Icon: Eye },
  procedure: { label: 'Procedures', Icon: Cog },
  function: { label: 'Functions', Icon: FunctionSquare },
};

const MOCK_CATALOG: CatalogObject[] = [
  { kind: 'table', schema: 'public', name: 'orders' },
  { kind: 'table', schema: 'public', name: 'order_items' },
  { kind: 'table', schema: 'public', name: 'customers' },
  { kind: 'table', schema: 'reporting', name: 'daily_sales' },
  { kind: 'view', schema: 'public', name: 'v_open_orders' },
  { kind: 'view', schema: 'reporting', name: 'v_customer_ltv' },
  { kind: 'procedure', schema: 'public', name: 'sp_fulfill_order' },
  { kind: 'procedure', schema: 'public', name: 'sp_refund' },
  { kind: 'function', schema: 'public', name: 'fn_order_total' },
  { kind: 'function', schema: 'reporting', name: 'fn_margin' },
];

const INITIAL_PRIVS: PrivilegeRow[] = [
  {
    id: 'p1',
    kind: 'table',
    schema: 'public',
    name: 'orders',
    dml: ['SELECT', 'INSERT'],
    ddl: [],
  },
  {
    id: 'p2',
    kind: 'table',
    schema: 'public',
    name: 'customers',
    dml: ['SELECT'],
    ddl: [],
  },
  {
    id: 'p3',
    kind: 'view',
    schema: 'public',
    name: 'v_open_orders',
    dml: ['SELECT'],
    ddl: [],
  },
  {
    id: 'p4',
    kind: 'procedure',
    schema: 'public',
    name: 'sp_fulfill_order',
    dml: ['EXECUTE'],
    ddl: [],
  },
  {
    id: 'p5',
    kind: 'schema',
    schema: 'reporting',
    name: 'reporting',
    dml: ['SELECT'],
    ddl: ['CREATE'],
  },
];

const PRINCIPALS = ['app_reader', 'app_writer', 'report_bot'] as const;

function allowedPrivsFor(kind: ObjectKind | 'schema' | 'database'): {
  dml: readonly string[];
  ddl: readonly string[];
} {
  if (kind === 'procedure' || kind === 'function') {
    return { dml: ['EXECUTE'], ddl: ['ALTER', 'DROP'] };
  }
  if (kind === 'view') {
    return { dml: ['SELECT'], ddl: ['ALTER', 'DROP', 'REFERENCES'] };
  }
  if (kind === 'schema') {
    return { dml: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], ddl: ['CREATE', 'ALTER', 'DROP'] };
  }
  if (kind === 'database') {
    return { dml: ['SELECT'], ddl: ['CREATE', 'ALTER'] };
  }
  return { dml: DML_PRIVS.filter((p) => p !== 'EXECUTE'), ddl: [...DDL_PRIVS] };
}

function buildPreviewSql(
  action: ActionMode,
  principal: string,
  objects: { schema: string; name: string; kind: string }[],
  privs: string[]
): string {
  if (!principal.trim() || objects.length === 0 || privs.length === 0) {
    return '-- Select a principal, objects, and privileges';
  }
  const verb = action === 'grant' ? 'GRANT' : 'REVOKE';
  const direction = action === 'grant' ? 'TO' : 'FROM';
  const list = privs.join(', ');
  return objects
    .map((o) => {
      const target =
        o.kind === 'schema'
          ? `SCHEMA ${o.schema}`
          : o.kind === 'database'
            ? `DATABASE ${o.name}`
            : `${o.kind.toUpperCase()} ${o.schema}.${o.name}`;
      return `${verb} ${list}\n  ON ${target}\n  ${direction} ${principal};`;
    })
    .join('\n\n');
}

/**
 * Prototype workspace: browse existing grants, edit one, or create a new grant
 * against a full object catalog (tables / views / procedures / functions) with
 * DML and DDL bands.
 */
export const PermissionUxPrototype: React.FC = () => {
  const [principal, setPrincipal] = useState<string>(PRINCIPALS[0]);
  const [privs, setPrivs] = useState<PrivilegeRow[]>(INITIAL_PRIVS);
  const [filterKind, setFilterKind] = useState<'all' | ObjectKind>('all');
  const [panel, setPanel] = useState<PanelMode>('browse');
  const [action, setAction] = useState<ActionMode>('grant');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [dmlSel, setDmlSel] = useState<string[]>(['SELECT']);
  const [ddlSel, setDdlSel] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const filteredPrivs = useMemo(
    () =>
      privs.filter((p) => {
        if (filterKind === 'all') return true;
        return p.kind === filterKind;
      }),
    [privs, filterKind]
  );

  const catalogByKind = useMemo(() => {
    const groups: Record<ObjectKind, CatalogObject[]> = {
      table: [],
      view: [],
      procedure: [],
      function: [],
    };
    for (const o of MOCK_CATALOG) groups[o.kind].push(o);
    return groups;
  }, []);

  const selectedObjects = useMemo(() => {
    return selectedKeys
      .map((key) => {
        const [kind, schema, name] = key.split(':') as [ObjectKind, string, string];
        return { kind, schema, name };
      })
      .filter((o) => o.kind && o.schema && o.name);
  }, [selectedKeys]);

  const formKind: ObjectKind | 'schema' | 'database' =
    selectedObjects[0]?.kind ??
    (editingId ? (privs.find((p) => p.id === editingId)?.kind ?? 'table') : 'table');

  // Union of what every selected (or edited) object can express, so a mixed
  // table + procedure pick still offers EXECUTE alongside SELECT.
  const allowed = useMemo(() => {
    const kinds: (ObjectKind | 'schema' | 'database')[] =
      selectedObjects.length > 0
        ? selectedObjects.map((o) => o.kind)
        : [formKind];
    const dml = new Set<string>();
    const ddl = new Set<string>();
    for (const k of kinds) {
      const a = allowedPrivsFor(k);
      a.dml.forEach((p) => dml.add(p));
      a.ddl.forEach((p) => ddl.add(p));
    }
    return { dml: [...dml], ddl: [...ddl] };
  }, [selectedObjects, formKind]);

  const previewTargets =
    selectedObjects.length > 0
      ? selectedObjects
      : editingId
        ? (() => {
            const row = privs.find((p) => p.id === editingId);
            if (!row) return [];
            return [
              {
                kind: String(row.kind),
                schema: row.schema ?? '',
                name: row.name,
              },
            ];
          })()
        : [];

  // Per-object preview: each target only gets privileges it can hold.
  const previewSql = previewTargets
    .map((o) => {
      const allow = allowedPrivsFor(o.kind as ObjectKind | 'schema' | 'database');
      const privList = [...dmlSel, ...ddlSel].filter(
        (p) => allow.dml.includes(p) || allow.ddl.includes(p)
      );
      return buildPreviewSql(action, principal, [o], privList);
    })
    .filter((s) => !s.startsWith('--'))
    .join('\n\n') || '-- Select a principal, objects, and privileges';

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const openCreate = () => {
    setPanel('create');
    setAction('grant');
    setEditingId(null);
    setSelectedKeys([]);
    setDmlSel(['SELECT']);
    setDdlSel([]);
  };

  const openEdit = (row: PrivilegeRow) => {
    setPanel('edit');
    setAction('grant');
    setEditingId(row.id);
    if (row.kind === 'table' || row.kind === 'view' || row.kind === 'procedure' || row.kind === 'function') {
      setSelectedKeys([`${row.kind}:${row.schema}:${row.name}`]);
    } else {
      setSelectedKeys([]);
    }
    setDmlSel([...row.dml]);
    setDdlSel([...row.ddl]);
  };

  const openRevoke = (row: PrivilegeRow) => {
    openEdit(row);
    setAction('revoke');
  };

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const togglePriv = (band: 'dml' | 'ddl', name: string) => {
    const setter = band === 'dml' ? setDmlSel : setDdlSel;
    setter((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  };

  const applyForm = () => {
    if (action === 'revoke' && editingId) {
      setPrivs((prev) => prev.filter((p) => p.id !== editingId));
      flash(`Revoked privileges from ${principal}`);
      setPanel('browse');
      setEditingId(null);
      return;
    }
    if (panel === 'edit' && editingId) {
      const row = privs.find((p) => p.id === editingId);
      const allow = allowedPrivsFor(row?.kind ?? 'table');
      const nextDml = dmlSel.filter((p) => allow.dml.includes(p));
      const nextDdl = ddlSel.filter((p) => allow.ddl.includes(p));
      setPrivs((prev) =>
        prev.map((p) => (p.id === editingId ? { ...p, dml: nextDml, ddl: nextDdl } : p))
      );
      flash(`Updated privileges for ${principal}`);
      setPanel('browse');
      setEditingId(null);
      return;
    }
    if (selectedObjects.length === 0) {
      flash('Pick at least one object from the catalog');
      return;
    }
    const created: PrivilegeRow[] = selectedObjects.map((o, i) => {
      const allow = allowedPrivsFor(o.kind);
      return {
        id: `new-${Date.now()}-${i}`,
        kind: o.kind,
        schema: o.schema,
        name: o.name,
        dml: dmlSel.filter((p) => allow.dml.includes(p)),
        ddl: ddlSel.filter((p) => allow.ddl.includes(p)),
      };
    });
    setPrivs((prev) => [...prev, ...created]);
    flash(`Granted ${created.length} object privilege set(s) to ${principal}`);
    setPanel('browse');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="permission-ux-prototype">
      <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-amber-100">Permissions UX prototype</p>
            <p className="text-[11px] text-amber-100/80 mt-0.5 leading-relaxed">
              Mock data only — review create / edit / grant / revoke with DML + DDL and a full
              object catalog (tables, views, procedures, functions). Nothing is applied to a
              database yet.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Left: principal + catalog */}
        <aside className="border-b lg:border-b-0 lg:border-r border-slate-800 overflow-y-auto p-3 space-y-4">
          <div>
            <span className={labelCls}>Principal</span>
            <select
              data-testid="proto-principal"
              className={`${inputCls} mt-1`}
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
            >
              {PRINCIPALS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className={labelCls}>Object catalog</span>
              <span className="text-[10px] text-slate-500">{MOCK_CATALOG.length} loaded</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              Loaded for grant targets. Tick objects when creating a permission.
            </p>
            {(Object.keys(KIND_META) as ObjectKind[]).map((kind) => {
              const meta = KIND_META[kind];
              const items = catalogByKind[kind];
              return (
                <div key={kind} className="mb-3" data-testid={`proto-catalog-${kind}`}>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 mb-1">
                    <meta.Icon className="w-3.5 h-3.5 text-slate-400" />
                    {meta.label}
                    <span className="text-slate-600 font-normal">({items.length})</span>
                  </div>
                  <ul className="space-y-0.5">
                    {items.map((o) => {
                      const key = `${o.kind}:${o.schema}:${o.name}`;
                      const checked = selectedKeys.includes(key);
                      const disabled = panel === 'browse';
                      return (
                        <li key={key}>
                          <label
                            className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] font-mono ${
                              disabled
                                ? 'text-slate-500'
                                : 'text-slate-200 hover:bg-slate-900 cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              data-testid={`proto-obj-${o.schema}-${o.name}`}
                              disabled={disabled}
                              checked={checked}
                              onChange={() => toggleKey(key)}
                              className="accent-amber-500"
                            />
                            <span className="truncate">
                              <span className="text-slate-500">{o.schema}.</span>
                              {o.name}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <div className="min-h-0 flex flex-col overflow-hidden">
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-800">
            <Segmented
              testId="proto-filter"
              value={filterKind}
              onChange={(v) => setFilterKind(v as 'all' | ObjectKind)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'table', label: 'Tables' },
                { value: 'view', label: 'Views' },
                { value: 'procedure', label: 'Procs' },
                { value: 'function', label: 'Funcs' },
              ]}
            />
            <div className="flex-1" />
            <button
              type="button"
              data-testid="proto-new-permission"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-100 hover:bg-amber-500/25"
            >
              <Plus className="w-3.5 h-3.5" />
              New permission
            </button>
          </div>

          {panel === 'browse' ? (
            <div className="flex-1 overflow-y-auto p-4" data-testid="proto-priv-list">
              <h2 className="text-sm font-bold text-slate-100 mb-1">
                Existing privileges · <span className="font-mono text-amber-200">{principal}</span>
              </h2>
              <p className="text-[11px] text-slate-500 mb-3">
                Edit loads the grant into the form. Revoke removes it. Create picks objects from the
                catalog and chooses DML / DDL privileges.
              </p>
              {filteredPrivs.length === 0 ? (
                <p className="text-[12px] text-slate-500 py-8 text-center">
                  No privileges in this filter. Create a new permission to start.
                </p>
              ) : (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-bold">Object</th>
                        <th className="px-3 py-2 font-bold">DML</th>
                        <th className="px-3 py-2 font-bold">DDL</th>
                        <th className="px-3 py-2 font-bold w-[140px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPrivs.map((row) => (
                        <tr
                          key={row.id}
                          data-testid={`proto-priv-row-${row.name}`}
                          className="border-t border-slate-800/80 hover:bg-slate-900/40"
                        >
                          <td className="px-3 py-2 font-mono text-slate-200">
                            <span className="text-[10px] uppercase text-slate-500 mr-1.5">
                              {row.kind}
                            </span>
                            {row.schema ? `${row.schema}.` : ''}
                            {row.name}
                          </td>
                          <td className="px-3 py-2">
                            <PrivChips names={row.dml} tone="dml" />
                          </td>
                          <td className="px-3 py-2">
                            <PrivChips names={row.ddl} tone="ddl" />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                data-testid={`proto-edit-${row.name}`}
                                onClick={() => openEdit(row)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-100"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                data-testid={`proto-revoke-${row.name}`}
                                onClick={() => openRevoke(row)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:text-rose-100"
                              >
                                <Trash2 className="w-3 h-3" />
                                Revoke
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="proto-form">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-100">
                  {panel === 'create' ? 'Create permission' : 'Edit permission'}
                </h2>
                <button
                  type="button"
                  data-testid="proto-form-close"
                  onClick={() => {
                    setPanel('browse');
                    setEditingId(null);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className={labelCls}>Action</span>
                <Segmented
                  testId="proto-action"
                  value={action}
                  onChange={(v) => setAction(v as ActionMode)}
                  options={[
                    { value: 'grant', label: 'Grant' },
                    { value: 'revoke', label: 'Revoke' },
                  ]}
                />
                <span className="text-[11px] text-slate-500 font-mono">→ {principal}</span>
              </div>

              {panel === 'create' && (
                <p className="text-[11px] text-slate-500">
                  Select objects in the left catalog ({selectedKeys.length} selected). Each object
                  only receives privileges it can hold (e.g. EXECUTE on procedures, SELECT on
                  views) even when you tick a mixed set.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <PrivBand
                  title="DML — data"
                  testId="proto-dml"
                  options={allowed.dml}
                  selected={dmlSel}
                  onToggle={(name) => togglePriv('dml', name)}
                />
                <PrivBand
                  title="DDL — schema"
                  testId="proto-ddl"
                  options={allowed.ddl}
                  selected={ddlSel}
                  onToggle={(name) => togglePriv('ddl', name)}
                />
              </div>

              <div>
                <span className={labelCls}>SQL preview</span>
                <pre
                  data-testid="proto-sql-preview"
                  className="mt-1 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto"
                >
                  {previewSql}
                </pre>
              </div>

              <button
                type="button"
                data-testid="proto-apply"
                onClick={applyForm}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold ${
                  action === 'revoke'
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-50 hover:bg-rose-500/30'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {action === 'revoke' ? 'Revoke privilege' : panel === 'edit' ? 'Save changes' : 'Grant privilege'}
              </button>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div
          data-testid="proto-toast"
          className="fixed bottom-4 right-4 z-[200] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[12px] text-slate-100 shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
};

const PrivChips: React.FC<{ names: string[]; tone: 'dml' | 'ddl' }> = ({ names, tone }) => {
  if (names.length === 0) {
    return <span className="text-slate-600">—</span>;
  }
  const cls =
    tone === 'dml'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : 'border-orange-500/30 bg-orange-500/10 text-orange-200';
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold font-mono ${cls}`}
        >
          {n}
        </span>
      ))}
    </div>
  );
};

const PrivBand: React.FC<{
  title: string;
  testId: string;
  options: readonly string[];
  selected: string[];
  onToggle: (name: string) => void;
}> = ({ title, testId, options, selected, onToggle }) => (
  <div className="rounded-lg border border-slate-800 p-3" data-testid={testId}>
    <div className={`${labelCls} mb-2`}>{title}</div>
    <div className="flex flex-wrap gap-2">
      {options.map((name) => {
        const on = selected.includes(name);
        return (
          <button
            key={name}
            type="button"
            data-testid={`${testId}-${name}`}
            onClick={() => onToggle(name)}
            className={`rounded-md border px-2 py-1 text-[11px] font-mono font-semibold transition ${
              on
                ? 'border-amber-500/50 bg-amber-500/20 text-amber-50'
                : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
            }`}
          >
            {name}
          </button>
        );
      })}
    </div>
  </div>
);
