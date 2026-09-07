/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive UX prototype for Database Access permissions.
 *
 * Expand an object kind to fetch that slice of the catalog. Edit can add more
 * tables (and other objects) to an existing grant. Apply opens a SQL preview
 * modal: copy always; execute only when FoxSchema RBAC allows editor.grant.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cog,
  Copy,
  Eye,
  FunctionSquare,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Play,
  ShieldAlert,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/app/store/authStore';
import { PERMISSION_META } from '@foxschema/shared';
import { inputCls, labelCls } from './controls';

const GRANT_PRIV_META = PERMISSION_META.find((m) => m.id === 'editor.grant');

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
    return '';
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

function objectKey(kind: string, schema: string | null, name: string): string {
  return `${kind}:${schema ?? ''}:${name}`;
}

/** Simulate a catalog fetch for one object kind (prototype only). */
function fetchCatalogKind(kind: ObjectKind): Promise<CatalogObject[]> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(MOCK_CATALOG.filter((o) => o.kind === kind));
    }, 420);
  });
}

export const PermissionUxPrototype: React.FC = () => {
  const canExecute = useAuthStore((s) => s.can('editor.grant'));

  const [principal, setPrincipal] = useState<string>(PRINCIPALS[0]);
  const [privs, setPrivs] = useState<PrivilegeRow[]>(INITIAL_PRIVS);
  const [panel, setPanel] = useState<PanelMode>('browse');
  const [action, setAction] = useState<ActionMode>('grant');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [dmlSel, setDmlSel] = useState<string[]>(['SELECT']);
  const [ddlSel, setDdlSel] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Catalog: expand → fetch. Collapsed kinds keep cache once loaded.
  const [expandedKinds, setExpandedKinds] = useState<Partial<Record<ObjectKind, boolean>>>({});
  const [catalogCache, setCatalogCache] = useState<Partial<Record<ObjectKind, CatalogObject[]>>>({});
  const [loadingKinds, setLoadingKinds] = useState<Partial<Record<ObjectKind, boolean>>>({});

  // Existing privileges accordion groups
  const [expandedPrivGroups, setExpandedPrivGroups] = useState<Partial<Record<string, boolean>>>({
    table: true,
    view: true,
    procedure: true,
    function: true,
    schema: true,
  });

  const [sqlModal, setSqlModal] = useState<{
    sql: string;
    title: string;
    pendingApply: () => void;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [executing, setExecuting] = useState(false);

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

  const previewTargets = useMemo(() => {
    if (selectedObjects.length > 0) return selectedObjects;
    if (!editingId) return [];
    const row = privs.find((p) => p.id === editingId);
    if (!row) return [];
    return [{ kind: String(row.kind), schema: row.schema ?? '', name: row.name }];
  }, [selectedObjects, editingId, privs]);

  const previewSql = useMemo(() => {
    const parts = previewTargets
      .map((o) => {
        const allow = allowedPrivsFor(o.kind as ObjectKind | 'schema' | 'database');
        const privList = [...dmlSel, ...ddlSel].filter(
          (p) => allow.dml.includes(p) || allow.ddl.includes(p)
        );
        return buildPreviewSql(action, principal, [o], privList);
      })
      .filter(Boolean);
    return parts.join('\n\n');
  }, [previewTargets, dmlSel, ddlSel, action, principal]);

  const privsByKind = useMemo(() => {
    const groups: Record<string, PrivilegeRow[]> = {};
    for (const p of privs) {
      (groups[p.kind] ??= []).push(p);
    }
    return groups;
  }, [privs]);

  useEffect(() => {
    if (!sqlModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSqlModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sqlModal]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const ensureKindLoaded = async (kind: ObjectKind) => {
    setExpandedKinds((prev) => ({ ...prev, [kind]: true }));
    if (catalogCache[kind] || loadingKinds[kind]) return;
    setLoadingKinds((prev) => ({ ...prev, [kind]: true }));
    try {
      const rows = await fetchCatalogKind(kind);
      setCatalogCache((prev) => ({ ...prev, [kind]: rows }));
    } finally {
      setLoadingKinds((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const toggleKind = async (kind: ObjectKind) => {
    const willExpand = !expandedKinds[kind];
    setExpandedKinds((prev) => ({ ...prev, [kind]: willExpand }));
    if (!willExpand) return;
    await ensureKindLoaded(kind);
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
      setSelectedKeys([objectKey(row.kind, row.schema, row.name)]);
    } else {
      setSelectedKeys([]);
    }
    setDmlSel([...row.dml]);
    setDdlSel([...row.ddl]);
    // Open the matching catalog kind so the reader can add peer objects.
    if (row.kind === 'table' || row.kind === 'view' || row.kind === 'procedure' || row.kind === 'function') {
      void ensureKindLoaded(row.kind);
    }
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

  const commitApply = () => {
    if (action === 'revoke' && editingId) {
      setPrivs((prev) => prev.filter((p) => p.id !== editingId));
      flash(`Revoked privileges from ${principal}`);
      setPanel('browse');
      setEditingId(null);
      return;
    }
    if (panel === 'edit' && editingId) {
      // Edit may add objects: first row updates the edited grant; extra keys become new rows.
      const primary = privs.find((p) => p.id === editingId);
      const keys = selectedObjects.length
        ? selectedObjects
        : primary
          ? [{ kind: primary.kind as ObjectKind, schema: primary.schema ?? '', name: primary.name }]
          : [];
      if (keys.length === 0) {
        flash('Keep at least one object on this permission');
        return;
      }
      setPrivs((prev) => {
        let next = [...prev];
        const [first, ...rest] = keys;
        const allow0 = allowedPrivsFor(first!.kind as ObjectKind | 'schema' | 'database');
        next = next.map((p) =>
          p.id === editingId
            ? {
                ...p,
                kind: first!.kind as PrivilegeRow['kind'],
                schema: first!.schema,
                name: first!.name,
                dml: dmlSel.filter((x) => allow0.dml.includes(x)),
                ddl: ddlSel.filter((x) => allow0.ddl.includes(x)),
              }
            : p
        );
        for (const o of rest) {
          const allow = allowedPrivsFor(o.kind);
          const exists = next.some(
            (p) => p.kind === o.kind && p.schema === o.schema && p.name === o.name
          );
          if (exists) {
            next = next.map((p) =>
              p.kind === o.kind && p.schema === o.schema && p.name === o.name
                ? {
                    ...p,
                    dml: dmlSel.filter((x) => allow.dml.includes(x)),
                    ddl: ddlSel.filter((x) => allow.ddl.includes(x)),
                  }
                : p
            );
          } else {
            next.push({
              id: `new-${Date.now()}-${o.name}`,
              kind: o.kind,
              schema: o.schema,
              name: o.name,
              dml: dmlSel.filter((x) => allow.dml.includes(x)),
              ddl: ddlSel.filter((x) => allow.ddl.includes(x)),
            });
          }
        }
        return next;
      });
      flash(
        rest.length
          ? `Updated permission and added ${rest.length} object(s) for ${principal}`
          : `Updated privileges for ${principal}`
      );
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

  const openSqlModal = () => {
    if (!previewSql) {
      flash('Select objects and privileges first');
      return;
    }
    setCopied(false);
    setSqlModal({
      sql: previewSql,
      title:
        action === 'revoke'
          ? 'Preview REVOKE SQL'
          : panel === 'edit'
            ? 'Preview UPDATE grant SQL'
            : 'Preview GRANT SQL',
      pendingApply: commitApply,
    });
  };

  const copySql = async () => {
    if (!sqlModal) return;
    try {
      await navigator.clipboard.writeText(sqlModal.sql);
      setCopied(true);
      flash('SQL copied');
    } catch {
      flash('Could not copy — select the SQL manually');
    }
  };

  const executeSql = async () => {
    if (!sqlModal || !canExecute) return;
    setExecuting(true);
    // Prototype: pretend RBAC-approved execute, then apply local state.
    await new Promise((r) => window.setTimeout(r, 500));
    sqlModal.pendingApply();
    setExecuting(false);
    setSqlModal(null);
    flash('Executed (prototype) — grants updated locally');
  };

  const applyWithoutExecute = () => {
    if (!sqlModal) return;
    sqlModal.pendingApply();
    setSqlModal(null);
  };

  const catalogSelectable = panel === 'create' || panel === 'edit';

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="permission-ux-prototype">
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b lg:border-b-0 lg:border-r border-slate-800 overflow-y-auto p-3 space-y-3">
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
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className={labelCls}>Object catalog</span>
              <span className="text-[10px] text-slate-500">Expand to fetch</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              {catalogSelectable
                ? 'Tick objects to include in this permission (edit can add more tables).'
                : 'Expand a kind to load objects. Start Create or Edit to select them.'}
            </p>
            {(Object.keys(KIND_META) as ObjectKind[]).map((kind) => {
              const meta = KIND_META[kind];
              const open = !!expandedKinds[kind];
              const loading = !!loadingKinds[kind];
              const items = catalogCache[kind];
              return (
                <div key={kind} className="mb-1 rounded-md border border-slate-800/80" data-testid={`proto-catalog-${kind}`}>
                  <button
                    type="button"
                    data-testid={`proto-expand-${kind}`}
                    aria-expanded={open}
                    onClick={() => void toggleKind(kind)}
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-900/60"
                  >
                    {open ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <meta.Icon className="w-3.5 h-3.5 text-slate-400" />
                    {meta.label}
                    {items && (
                      <span className="text-slate-600 font-normal">({items.length})</span>
                    )}
                    {loading && <Loader2 className="w-3 h-3 ml-auto animate-spin text-amber-300" />}
                  </button>
                  {open && (
                    <div className="border-t border-slate-800/80 px-1.5 py-1">
                      {loading && !items && (
                        <p className="text-[11px] text-slate-500 px-1 py-2">Fetching {meta.label.toLowerCase()}…</p>
                      )}
                      {items && items.length === 0 && (
                        <p className="text-[11px] text-slate-500 px-1 py-2">None found.</p>
                      )}
                      {items && (
                        <ul className="space-y-0.5">
                          {items.map((o) => {
                            const key = objectKey(o.kind, o.schema, o.name);
                            const checked = selectedKeys.includes(key);
                            return (
                              <li key={key}>
                                <label
                                  className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] font-mono ${
                                    catalogSelectable
                                      ? 'text-slate-200 hover:bg-slate-900 cursor-pointer'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    data-testid={`proto-obj-${o.schema}-${o.name}`}
                                    disabled={!catalogSelectable}
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
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="min-h-0 flex flex-col overflow-hidden">
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-800">
            <p className="text-[11px] text-slate-500">
              Principal <span className="font-mono text-amber-200">{principal}</span>
            </p>
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
            <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="proto-priv-list">
              <h2 className="text-sm font-bold text-slate-100 mb-1">Existing privileges</h2>
              <p className="text-[11px] text-slate-500 mb-3">
                Expand a group to review. Edit loads the grant and lets you add more tables from the
                catalog. Revoke / save opens a SQL preview modal.
              </p>
              {(['table', 'view', 'procedure', 'function', 'schema', 'database'] as const).map(
                (kind) => {
                  const rows = privsByKind[kind];
                  if (!rows?.length) return null;
                  const open = expandedPrivGroups[kind] !== false;
                  return (
                    <div
                      key={kind}
                      className="rounded-lg border border-slate-800 overflow-hidden"
                      data-testid={`proto-priv-group-${kind}`}
                    >
                      <button
                        type="button"
                        data-testid={`proto-priv-expand-${kind}`}
                        onClick={() =>
                          setExpandedPrivGroups((prev) => ({ ...prev, [kind]: !open }))
                        }
                        className="flex w-full items-center gap-2 px-3 py-2 bg-slate-900/60 text-[11px] font-bold uppercase tracking-wide text-slate-400 hover:text-slate-200"
                      >
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        {kind}
                        <span className="font-normal normal-case text-slate-600">({rows.length})</span>
                      </button>
                      {open && (
                        <table className="w-full text-left text-[12px]">
                          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-1.5 font-bold">Object</th>
                              <th className="px-3 py-1.5 font-bold">DML</th>
                              <th className="px-3 py-1.5 font-bold">DDL</th>
                              <th className="px-3 py-1.5 font-bold w-[140px]">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr
                                key={row.id}
                                data-testid={`proto-priv-row-${row.name}`}
                                className="border-t border-slate-800/80 hover:bg-slate-900/40"
                              >
                                <td className="px-3 py-2 font-mono text-slate-200">
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
                      )}
                    </div>
                  );
                }
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

              <div className="flex flex-wrap items-center gap-2">
                <span className={labelCls}>Action</span>
                <button
                  type="button"
                  data-testid="proto-action-grant"
                  onClick={() => setAction('grant')}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    action === 'grant'
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-50'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  Grant
                </button>
                <button
                  type="button"
                  data-testid="proto-action-revoke"
                  onClick={() => setAction('revoke')}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    action === 'revoke'
                      ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  Revoke
                </button>
                <span className="text-[11px] text-slate-500 font-mono">→ {principal}</span>
              </div>

              {panel === 'edit' && (
                <p className="text-[11px] text-slate-500 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2">
                  Expand catalog kinds on the left and tick more tables (or views / routines) to
                  add them to this permission. Selected: {selectedKeys.length}.
                </p>
              )}
              {panel === 'create' && (
                <p className="text-[11px] text-slate-500">
                  Expand catalog kinds, select objects ({selectedKeys.length}), then choose DML /
                  DDL. Each object only receives privileges it can hold.
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

              <button
                type="button"
                data-testid="proto-preview-sql"
                onClick={openSqlModal}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold ${
                  action === 'revoke'
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-50 hover:bg-rose-500/30'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Preview SQL
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

      {sqlModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[340] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setSqlModal(null)}
            data-testid="proto-sql-modal-backdrop"
          >
            <div
              className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="proto-sql-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="text-sm font-bold text-slate-100">{sqlModal.title}</h3>
                <button
                  type="button"
                  onClick={() => setSqlModal(null)}
                  className="text-slate-500 hover:text-slate-200"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <pre
                data-testid="proto-sql-preview"
                className="text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded px-3 py-2 mb-3 overflow-x-auto whitespace-pre-wrap max-h-64"
              >
                {sqlModal.sql}
              </pre>
              {!canExecute && (
                <p className="mb-3 flex items-start gap-2 text-[11px] text-slate-400">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                  Your FoxSchema role cannot execute GRANT / REVOKE (needs{' '}
                  <span className="text-slate-200">
                    {GRANT_PRIV_META?.label ?? 'editor.grant'}
                  </span>
                  ). Copy the SQL and run it elsewhere, or ask an owner to grant that permission.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                  onClick={() => setSqlModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="proto-sql-copy"
                  onClick={() => void copySql()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-100 hover:bg-slate-800"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy SQL'}
                </button>
                {canExecute ? (
                  <button
                    type="button"
                    data-testid="proto-sql-execute"
                    disabled={executing}
                    onClick={() => void executeSql()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
                  >
                    {executing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Execute
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="proto-sql-apply-local"
                    onClick={applyWithoutExecute}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
                    title="Prototype only: updates the mock list without DB execute"
                  >
                    Apply to preview list
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
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
