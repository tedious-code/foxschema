/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Permissions UX prototype — sectioned by object kind.
 *
 * Top: General permissions (schema CREATE — table/view/proc/function/type/
 * constraint/trigger/sequence/FK) with no CRUD detail. Below: expand Tables /
 * Views / Procedures / Functions to fetch objects; each row shows DML + DDL.
 * Edit opens Grant / Revoke → Preview SQL modal (Copy / Execute by RBAC).
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
  Play,
  Plus,
  Shield,
  ShieldAlert,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { PERMISSION_META } from '@foxschema/shared';
import { useAuthStore } from '@/app/store/authStore';
import { inputCls, labelCls } from './controls';

type ObjectKind = 'table' | 'view' | 'procedure' | 'function';
type ActionMode = 'grant' | 'revoke';

/** Schema-level CREATE privileges — no per-object CRUD detail. */
type GeneralPrivId =
  | 'create-table'
  | 'create-view'
  | 'create-procedure'
  | 'create-function'
  | 'create-datatype'
  | 'create-constraint'
  | 'create-trigger'
  | 'create-sequence'
  | 'create-foreign-key';

const GENERAL_PRIVILEGES: {
  id: GeneralPrivId;
  label: string;
  sql: string;
  hint: string;
}[] = [
  { id: 'create-table', label: 'Create table', sql: 'CREATE TABLE', hint: 'Create new tables in the schema' },
  { id: 'create-view', label: 'Create view', sql: 'CREATE VIEW', hint: 'Create views' },
  { id: 'create-procedure', label: 'Create procedure', sql: 'CREATE PROCEDURE', hint: 'Create stored procedures' },
  { id: 'create-function', label: 'Create function', sql: 'CREATE FUNCTION', hint: 'Create functions' },
  { id: 'create-datatype', label: 'Create datatype', sql: 'CREATE TYPE', hint: 'Create user-defined types' },
  { id: 'create-constraint', label: 'Create constraint', sql: 'CREATE CONSTRAINT', hint: 'Add constraints on tables' },
  { id: 'create-trigger', label: 'Create trigger', sql: 'CREATE TRIGGER', hint: 'Create triggers' },
  { id: 'create-sequence', label: 'Create sequence', sql: 'CREATE SEQUENCE', hint: 'Create sequences' },
  {
    id: 'create-foreign-key',
    label: 'Create foreign key',
    sql: 'REFERENCES',
    hint: 'Create foreign keys / reference other tables',
  },
];

const MOCK_SCHEMAS = ['public', 'reporting'] as const;

interface CatalogObject {
  kind: ObjectKind;
  schema: string;
  name: string;
}

/** Privileges held on one object (may be empty before any grant). */
interface ObjectPrivState {
  kind: ObjectKind;
  schema: string;
  name: string;
  dml: string[];
  ddl: string[];
}

const KIND_ORDER: ObjectKind[] = ['table', 'view', 'procedure', 'function'];

const KIND_META: Record<
  ObjectKind,
  { label: string; singular: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  table: { label: 'Tables', singular: 'table', Icon: Table2 },
  view: { label: 'Views', singular: 'view', Icon: Eye },
  procedure: { label: 'Procedures', singular: 'procedure', Icon: Cog },
  function: { label: 'Functions', singular: 'function', Icon: FunctionSquare },
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

/** Seeded grants so the Tables section is not empty on first expand. */
const INITIAL_GRANTS: ObjectPrivState[] = [
  { kind: 'table', schema: 'public', name: 'orders', dml: ['SELECT', 'INSERT', 'UPDATE'], ddl: [] },
  { kind: 'table', schema: 'public', name: 'customers', dml: ['SELECT'], ddl: [] },
  { kind: 'table', schema: 'public', name: 'order_items', dml: ['SELECT', 'INSERT', 'UPDATE'], ddl: [] },
  { kind: 'view', schema: 'public', name: 'v_open_orders', dml: ['SELECT'], ddl: [] },
  { kind: 'procedure', schema: 'public', name: 'sp_fulfill_order', dml: ['EXECUTE'], ddl: [] },
  { kind: 'function', schema: 'public', name: 'fn_order_total', dml: ['EXECUTE'], ddl: [] },
];

const PRINCIPALS = ['app_reader', 'app_writer', 'report_bot'] as const;
const GRANT_PRIV_META = PERMISSION_META.find((m) => m.id === 'editor.grant');

function allowedPrivsFor(kind: ObjectKind): { dml: readonly string[]; ddl: readonly string[] } {
  if (kind === 'procedure' || kind === 'function') {
    return { dml: ['EXECUTE'], ddl: ['ALTER', 'DROP'] };
  }
  if (kind === 'view') {
    return { dml: ['SELECT'], ddl: ['ALTER', 'DROP', 'REFERENCES'] };
  }
  return {
    dml: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    ddl: ['CREATE', 'ALTER', 'DROP', 'REFERENCES', 'TRIGGER', 'INDEX'],
  };
}

function objectKey(o: { kind: string; schema: string; name: string }): string {
  return `${o.kind}:${o.schema}:${o.name}`;
}

function fetchCatalogKind(kind: ObjectKind): Promise<CatalogObject[]> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(MOCK_CATALOG.filter((o) => o.kind === kind));
    }, 380);
  });
}

function buildSql(
  action: ActionMode,
  principal: string,
  objects: { kind: ObjectKind; schema: string; name: string }[],
  dml: string[],
  ddl: string[]
): string {
  if (!principal.trim() || objects.length === 0) return '';
  const verb = action === 'grant' ? 'GRANT' : 'REVOKE';
  const direction = action === 'grant' ? 'TO' : 'FROM';
  return objects
    .map((o) => {
      const allow = allowedPrivsFor(o.kind);
      const privs = [...dml, ...ddl].filter((p) => allow.dml.includes(p) || allow.ddl.includes(p));
      if (privs.length === 0) return '';
      return `${verb} ${privs.join(', ')}\n  ON ${o.kind.toUpperCase()} ${o.schema}.${o.name}\n  ${direction} ${principal};`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildGeneralSql(
  action: ActionMode,
  principal: string,
  schema: string,
  privIds: GeneralPrivId[]
): string {
  if (!principal.trim() || !schema.trim() || privIds.length === 0) return '';
  const verb = action === 'grant' ? 'GRANT' : 'REVOKE';
  const direction = action === 'grant' ? 'TO' : 'FROM';
  const list = privIds
    .map((id) => GENERAL_PRIVILEGES.find((p) => p.id === id)?.sql)
    .filter(Boolean)
    .join(', ');
  return `${verb} ${list}\n  ON SCHEMA ${schema}\n  ${direction} ${principal};`;
}

type EditorState = {
  kind: ObjectKind;
  /** Row being edited, or null when granting onto new objects of this kind. */
  focus: ObjectPrivState | null;
  action: ActionMode;
  selectedKeys: string[];
  dml: string[];
  ddl: string[];
};

type GeneralEditorState = {
  action: ActionMode;
  schema: string;
  selected: GeneralPrivId[];
};

export const PermissionUxPrototype: React.FC = () => {
  const canExecute = useAuthStore((s) => s.can('editor.grant'));

  const [principal, setPrincipal] = useState<string>(PRINCIPALS[0]);
  const [grants, setGrants] = useState<ObjectPrivState[]>(INITIAL_GRANTS);
  /** Schema → granted general CREATE privilege ids (no CRUD detail). */
  const [generalBySchema, setGeneralBySchema] = useState<Record<string, GeneralPrivId[]>>({
    public: ['create-table', 'create-sequence'],
    reporting: ['create-view'],
  });
  const [generalOpen, setGeneralOpen] = useState(true);
  const [generalEditor, setGeneralEditor] = useState<GeneralEditorState | null>(null);

  const [expanded, setExpanded] = useState<Partial<Record<ObjectKind, boolean>>>({ table: true });
  const [catalog, setCatalog] = useState<Partial<Record<ObjectKind, CatalogObject[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<ObjectKind, boolean>>>({});
  // Tables start expanded — fetch on mount for the default section.
  const [fetchedOnce, setFetchedOnce] = useState<Partial<Record<ObjectKind, boolean>>>({});

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [sqlModal, setSqlModal] = useState<{
    sql: string;
    title: string;
    apply: () => void;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const ensureFetched = async (kind: ObjectKind) => {
    if (fetchedOnce[kind] || loading[kind]) return;
    setLoading((p) => ({ ...p, [kind]: true }));
    try {
      const rows = await fetchCatalogKind(kind);
      setCatalog((p) => ({ ...p, [kind]: rows }));
      setFetchedOnce((p) => ({ ...p, [kind]: true }));
    } finally {
      setLoading((p) => ({ ...p, [kind]: false }));
    }
  };

  useEffect(() => {
    void ensureFetched('table');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prototype: load default Tables section once
  }, []);

  useEffect(() => {
    if (!sqlModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSqlModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sqlModal]);

  const toggleSection = (kind: ObjectKind) => {
    const willOpen = !expanded[kind];
    setExpanded((p) => ({ ...p, [kind]: willOpen }));
    if (willOpen) void ensureFetched(kind);
  };

  /** Rows for a section: every fetched catalog object + any grant-only leftovers. */
  const rowsForKind = (kind: ObjectKind): ObjectPrivState[] => {
    const objects = catalog[kind] ?? [];
    const byKey = new Map<string, ObjectPrivState>();
    for (const o of objects) {
      const g = grants.find((x) => x.kind === o.kind && x.schema === o.schema && x.name === o.name);
      byKey.set(objectKey(o), {
        kind: o.kind,
        schema: o.schema,
        name: o.name,
        dml: g?.dml ?? [],
        ddl: g?.ddl ?? [],
      });
    }
    for (const g of grants) {
      if (g.kind !== kind) continue;
      const k = objectKey(g);
      if (!byKey.has(k)) byKey.set(k, g);
    }
    return [...byKey.values()].sort((a, b) =>
      `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`)
    );
  };

  const openEdit = (row: ObjectPrivState, action: ActionMode = 'grant') => {
    const allow = allowedPrivsFor(row.kind);
    setGeneralEditor(null);
    setEditor({
      kind: row.kind,
      focus: row,
      action,
      selectedKeys: [objectKey(row)],
      dml: action === 'revoke' ? [...row.dml] : row.dml.length ? [...row.dml] : [...allow.dml].slice(0, 1),
      ddl: action === 'revoke' ? [...row.ddl] : [...row.ddl],
    });
    setExpanded((p) => ({ ...p, [row.kind]: true }));
    void ensureFetched(row.kind);
  };

  const openGrantOnKind = (kind: ObjectKind) => {
    const allow = allowedPrivsFor(kind);
    setGeneralEditor(null);
    setEditor({
      kind,
      focus: null,
      action: 'grant',
      selectedKeys: [],
      dml: [...allow.dml].slice(0, 1),
      ddl: [],
    });
    setExpanded((p) => ({ ...p, [kind]: true }));
    void ensureFetched(kind);
  };

  const editorObjects = useMemo(() => {
    if (!editor) return [];
    return editor.selectedKeys
      .map((key) => {
        const [kind, schema, name] = key.split(':') as [ObjectKind, string, string];
        return { kind, schema, name };
      })
      .filter((o) => o.kind && o.schema && o.name);
  }, [editor]);

  const previewSql = useMemo(() => {
    if (generalEditor) {
      return buildGeneralSql(
        generalEditor.action,
        principal,
        generalEditor.schema,
        generalEditor.selected
      );
    }
    if (!editor) return '';
    return buildSql(editor.action, principal, editorObjects, editor.dml, editor.ddl);
  }, [editor, generalEditor, principal, editorObjects]);

  const applyGeneralEditor = () => {
    if (!generalEditor || generalEditor.selected.length === 0) {
      flash('Select at least one general privilege');
      return;
    }
    const schema = generalEditor.schema;
    if (generalEditor.action === 'revoke') {
      setGeneralBySchema((prev) => {
        const cur = new Set(prev[schema] ?? []);
        for (const id of generalEditor.selected) cur.delete(id);
        return { ...prev, [schema]: [...cur] };
      });
      flash(`Revoked general privileges on ${schema}`);
    } else {
      setGeneralBySchema((prev) => {
        const cur = new Set(prev[schema] ?? []);
        for (const id of generalEditor.selected) cur.add(id);
        return { ...prev, [schema]: [...cur] };
      });
      flash(`Granted general privileges on ${schema}`);
    }
    setGeneralEditor(null);
  };

  const applyEditorToGrants = () => {
    if (!editor || editorObjects.length === 0) {
      flash(`Select at least one ${KIND_META[editor?.kind ?? 'table'].singular}`);
      return;
    }
    if (editor.action === 'revoke') {
      setGrants((prev) =>
        prev
          .map((g) => {
            if (!editorObjects.some((o) => o.kind === g.kind && o.schema === g.schema && o.name === g.name)) {
              return g;
            }
            const allow = allowedPrivsFor(g.kind);
            const removeDml = new Set(editor.dml.filter((p) => allow.dml.includes(p)));
            const removeDdl = new Set(editor.ddl.filter((p) => allow.ddl.includes(p)));
            const dml = g.dml.filter((p) => !removeDml.has(p));
            const ddl = g.ddl.filter((p) => !removeDdl.has(p));
            if (dml.length === 0 && ddl.length === 0) return null;
            return { ...g, dml, ddl };
          })
          .filter((g): g is ObjectPrivState => g != null)
      );
      flash(`Revoked from ${principal}`);
    } else {
      setGrants((prev) => {
        let next = [...prev];
        for (const o of editorObjects) {
          const allow = allowedPrivsFor(o.kind);
          const dml = editor.dml.filter((p) => allow.dml.includes(p));
          const ddl = editor.ddl.filter((p) => allow.ddl.includes(p));
          const idx = next.findIndex((g) => g.kind === o.kind && g.schema === o.schema && g.name === o.name);
          if (idx >= 0) {
            next[idx] = { ...next[idx]!, dml, ddl };
          } else {
            next.push({ kind: o.kind, schema: o.schema, name: o.name, dml, ddl });
          }
        }
        return next;
      });
      flash(`Granted to ${principal}`);
    }
    setEditor(null);
  };

  const openPreview = () => {
    if (!previewSql) {
      flash('Select privileges first');
      return;
    }
    setCopied(false);
    const isRevoke = generalEditor
      ? generalEditor.action === 'revoke'
      : editor?.action === 'revoke';
    setSqlModal({
      sql: previewSql,
      title: isRevoke ? 'Preview REVOKE SQL' : 'Preview GRANT SQL',
      apply: generalEditor ? applyGeneralEditor : applyEditorToGrants,
    });
  };

  const openGeneralEdit = (schema: string, action: ActionMode = 'grant') => {
    const held = generalBySchema[schema] ?? [];
    setEditor(null);
    setGeneralEditor({
      action,
      schema,
      selected:
        action === 'revoke'
          ? [...held]
          : held.length
            ? [...held]
            : ['create-table'],
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
    await new Promise((r) => window.setTimeout(r, 450));
    sqlModal.apply();
    setExecuting(false);
    setSqlModal(null);
    flash('Executed (prototype)');
  };

  const toggleKey = (key: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const selectedKeys = prev.selectedKeys.includes(key)
        ? prev.selectedKeys.filter((k) => k !== key)
        : [...prev.selectedKeys, key];
      return { ...prev, selectedKeys };
    });
  };

  const togglePriv = (band: 'dml' | 'ddl', name: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const list = band === 'dml' ? prev.dml : prev.ddl;
      const next = list.includes(name) ? list.filter((p) => p !== name) : [...list, name];
      return band === 'dml' ? { ...prev, dml: next } : { ...prev, ddl: next };
    });
  };

  const allow = editor ? allowedPrivsFor(editor.kind) : { dml: [] as string[], ddl: [] as string[] };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="permission-ux-prototype">
      <div className="shrink-0 flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-slate-800">
        <div className="min-w-[180px]">
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
        <p className="text-[11px] text-slate-500 max-w-xl leading-relaxed">
          Top section: <span className="text-slate-300">general CREATE privileges</span> (no CRUD
          detail). Below: expand Tables / Views / Procedures / Functions for object DML + DDL. Edit
          opens Grant / Revoke → Preview SQL.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" data-testid="proto-sections">
        {/* General schema CREATE privileges — create new privilege without object CRUD detail */}
        <section
          className="rounded-lg border border-slate-800 overflow-hidden"
          data-testid="proto-section-general"
        >
          <div className="flex items-center gap-2 bg-slate-900/70 px-3 py-2">
            <button
              type="button"
              data-testid="proto-expand-general"
              aria-expanded={generalOpen}
              onClick={() => setGeneralOpen((v) => !v)}
              className="flex flex-1 items-center gap-2 text-left text-xs font-bold text-slate-100 hover:text-white"
            >
              {generalOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500" />
              )}
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              General permissions
              <span className="font-normal text-slate-500 normal-case tracking-normal">
                (create table, view, procedure, …)
              </span>
            </button>
            <button
              type="button"
              data-testid="proto-grant-general"
              onClick={() => openGeneralEdit(MOCK_SCHEMAS[0], 'grant')}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-100 hover:bg-amber-500/20"
            >
              <Plus className="w-3 h-3" />
              New privilege
            </button>
          </div>

          {generalOpen && (
            <div className="border-t border-slate-800">
              <p className="px-3 pt-2 text-[11px] text-slate-500">
                Schema-level CREATE rights. No per-object CRUD — use the sections below for that.
              </p>
              <table className="w-full text-left text-[12px] mt-1">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-bold">Schema</th>
                    <th className="px-3 py-2 font-bold">Create privileges</th>
                    <th className="px-3 py-2 font-bold w-[150px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_SCHEMAS.map((schema) => {
                    const held = generalBySchema[schema] ?? [];
                    return (
                      <tr
                        key={schema}
                        data-testid={`proto-general-row-${schema}`}
                        className="border-t border-slate-800/80 hover:bg-slate-900/40"
                      >
                        <td className="px-3 py-2 font-mono text-slate-200">{schema}</td>
                        <td className="px-3 py-2">
                          {held.length === 0 ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {held.map((id) => {
                                const meta = GENERAL_PRIVILEGES.find((p) => p.id === id);
                                return (
                                  <span
                                    key={id}
                                    title={meta?.hint}
                                    className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-100"
                                  >
                                    {meta?.label ?? id}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              data-testid={`proto-general-edit-${schema}`}
                              onClick={() => openGeneralEdit(schema, 'grant')}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-100"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              data-testid={`proto-general-revoke-${schema}`}
                              disabled={held.length === 0}
                              onClick={() => openGeneralEdit(schema, 'revoke')}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:text-rose-100 disabled:opacity-30"
                            >
                              <Trash2 className="w-3 h-3" />
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {KIND_ORDER.map((kind) => {
          const meta = KIND_META[kind];
          const open = !!expanded[kind];
          const isLoading = !!loading[kind];
          const rows = open ? rowsForKind(kind) : [];
          return (
            <section
              key={kind}
              className="rounded-lg border border-slate-800 overflow-hidden"
              data-testid={`proto-section-${kind}`}
            >
              <div className="flex items-center gap-2 bg-slate-900/70 px-3 py-2">
                <button
                  type="button"
                  data-testid={`proto-expand-${kind}`}
                  aria-expanded={open}
                  onClick={() => toggleSection(kind)}
                  className="flex flex-1 items-center gap-2 text-left text-xs font-bold text-slate-100 hover:text-white"
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                  <meta.Icon className="w-3.5 h-3.5 text-slate-400" />
                  {meta.label}
                  {catalog[kind] && (
                    <span className="font-normal text-slate-500">({catalog[kind]!.length})</span>
                  )}
                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />}
                </button>
                <button
                  type="button"
                  data-testid={`proto-grant-${kind}`}
                  onClick={() => openGrantOnKind(kind)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-100 hover:bg-amber-500/20"
                >
                  <Plus className="w-3 h-3" />
                  Grant
                </button>
              </div>

              {open && (
                <div className="border-t border-slate-800">
                  {isLoading && rows.length === 0 ? (
                    <p className="px-3 py-4 text-[11px] text-slate-500">
                      Fetching {meta.label.toLowerCase()}…
                    </p>
                  ) : rows.length === 0 ? (
                    <p className="px-3 py-4 text-[11px] text-slate-500">
                      No {meta.label.toLowerCase()} loaded. Expand again or use Grant.
                    </p>
                  ) : (
                    <table className="w-full text-left text-[12px]">
                      <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-bold">{meta.singular}</th>
                          <th className="px-3 py-2 font-bold">DML</th>
                          <th className="px-3 py-2 font-bold">DDL</th>
                          <th className="px-3 py-2 font-bold w-[150px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={objectKey(row)}
                            data-testid={`proto-priv-row-${row.name}`}
                            className="border-t border-slate-800/80 hover:bg-slate-900/40"
                          >
                            <td className="px-3 py-2 font-mono text-slate-200">
                              <span className="text-slate-500">{row.schema}.</span>
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
                                  onClick={() => openEdit(row, 'grant')}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-100"
                                >
                                  <Pencil className="w-3 h-3" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  data-testid={`proto-revoke-${row.name}`}
                                  disabled={row.dml.length === 0 && row.ddl.length === 0}
                                  onClick={() => openEdit(row, 'revoke')}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:text-rose-100 disabled:opacity-30"
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
              )}
            </section>
          );
        })}
      </div>

      {generalEditor &&
        createPortal(
          <div
            className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setGeneralEditor(null)}
            data-testid="proto-general-editor-backdrop"
          >
            <div
              className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              data-testid="proto-general-editor"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    {generalEditor.action === 'revoke' ? 'Revoke' : 'Create'} general privilege
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-mono">→ {principal}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setGeneralEditor(null)}
                  className="text-slate-500 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  data-testid="proto-general-action-grant"
                  onClick={() => setGeneralEditor((p) => (p ? { ...p, action: 'grant' } : p))}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    generalEditor.action === 'grant'
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-50'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  Grant
                </button>
                <button
                  type="button"
                  data-testid="proto-general-action-revoke"
                  onClick={() => setGeneralEditor((p) => (p ? { ...p, action: 'revoke' } : p))}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    generalEditor.action === 'revoke'
                      ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  Revoke
                </button>
              </div>

              <div className="mb-4">
                <span className={labelCls}>Schema</span>
                <select
                  data-testid="proto-general-schema"
                  className={`${inputCls} mt-1`}
                  value={generalEditor.schema}
                  onChange={(e) => {
                    const schema = e.target.value;
                    setGeneralEditor((p) =>
                      p
                        ? {
                            ...p,
                            schema,
                            selected:
                              p.action === 'revoke'
                                ? [...(generalBySchema[schema] ?? [])]
                                : p.selected,
                          }
                        : p
                    );
                  }}
                >
                  {MOCK_SCHEMAS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <span className={labelCls}>Create privileges</span>
                <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
                  No CRUD detail — these allow creating objects in the schema.
                </p>
                <div className="flex flex-wrap gap-2" data-testid="proto-general-privs">
                  {GENERAL_PRIVILEGES.map((p) => {
                    const on = generalEditor.selected.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        title={p.hint}
                        data-testid={`proto-general-priv-${p.id}`}
                        onClick={() =>
                          setGeneralEditor((prev) => {
                            if (!prev) return prev;
                            const selected = prev.selected.includes(p.id)
                              ? prev.selected.filter((x) => x !== p.id)
                              : [...prev.selected, p.id];
                            return { ...prev, selected };
                          })
                        }
                        className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
                          on
                            ? 'border-violet-500/50 bg-violet-500/20 text-violet-50'
                            : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                data-testid="proto-general-preview-sql"
                onClick={openPreview}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold ${
                  generalEditor.action === 'revoke'
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Preview SQL
              </button>
            </div>
          </div>,
          document.body
        )}

      {editor &&
        createPortal(
          <div
            className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setEditor(null)}
            data-testid="proto-editor-backdrop"
          >
            <div
              className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              data-testid="proto-editor"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    {editor.action === 'revoke' ? 'Revoke' : 'Grant'} · {KIND_META[editor.kind].label}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-mono">→ {principal}</p>
                </div>
                <button type="button" onClick={() => setEditor(null)} className="text-slate-500 hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  data-testid="proto-action-grant"
                  onClick={() => setEditor((p) => (p ? { ...p, action: 'grant' } : p))}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    editor.action === 'grant'
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-50'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  Grant
                </button>
                <button
                  type="button"
                  data-testid="proto-action-revoke"
                  onClick={() => setEditor((p) => (p ? { ...p, action: 'revoke' } : p))}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    editor.action === 'revoke'
                      ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  Revoke
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={labelCls}>
                    {KIND_META[editor.kind].label} ({editor.selectedKeys.length} selected)
                  </span>
                  <span className="text-[10px] text-slate-500">Add more of the same kind</span>
                </div>
                <ul
                  className="max-h-36 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/50 p-1.5 space-y-0.5"
                  data-testid="proto-editor-objects"
                >
                  {(catalog[editor.kind] ?? []).map((o) => {
                    const key = objectKey(o);
                    const checked = editor.selectedKeys.includes(key);
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] font-mono text-slate-200 hover:bg-slate-900 cursor-pointer">
                          <input
                            type="checkbox"
                            data-testid={`proto-obj-${o.schema}-${o.name}`}
                            checked={checked}
                            onChange={() => toggleKey(key)}
                            className="accent-amber-500"
                          />
                          <span>
                            <span className="text-slate-500">{o.schema}.</span>
                            {o.name}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {!catalog[editor.kind]?.length && (
                    <li className="text-[11px] text-slate-500 px-2 py-2">
                      {loading[editor.kind] ? 'Loading…' : 'No objects — expand the section first.'}
                    </li>
                  )}
                </ul>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 mb-4">
                <PrivBand
                  title="DML"
                  testId="proto-dml"
                  options={allow.dml}
                  selected={editor.dml}
                  onToggle={(n) => togglePriv('dml', n)}
                />
                <PrivBand
                  title="DDL"
                  testId="proto-ddl"
                  options={allow.ddl}
                  selected={editor.ddl}
                  onToggle={(n) => togglePriv('ddl', n)}
                />
              </div>

              <button
                type="button"
                data-testid="proto-preview-sql"
                onClick={openPreview}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold ${
                  editor.action === 'revoke'
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Preview SQL
              </button>
            </div>
          </div>,
          document.body
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
                <button type="button" onClick={() => setSqlModal(null)} className="text-slate-500 hover:text-slate-200">
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
                  Your role cannot execute GRANT / REVOKE (needs{' '}
                  <span className="text-slate-200">{GRANT_PRIV_META?.label ?? 'editor.grant'}</span>
                  ). Copy the SQL instead.
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
                    {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Execute
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="proto-sql-apply-local"
                    onClick={() => {
                      sqlModal.apply();
                      setSqlModal(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
                  >
                    Apply to preview list
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {toast && (
        <div
          data-testid="proto-toast"
          className="fixed bottom-4 right-4 z-[350] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[12px] text-slate-100 shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
};

const PrivChips: React.FC<{ names: string[]; tone: 'dml' | 'ddl' }> = ({ names, tone }) => {
  if (names.length === 0) return <span className="text-slate-600">—</span>;
  const cls =
    tone === 'dml'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : 'border-orange-500/30 bg-orange-500/10 text-orange-200';
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span key={n} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold font-mono ${cls}`}>
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
