import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Columns3, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { effectiveConnectionIds } from '../../store/sqlEditorTabLogic';
import { TYPE_META } from '../SchemaTreePanel';
import { filterCallParameters, insertAtCursor } from './sqlEditorBridge';
import type { DbObjectType, TableSchema } from '../../lib/types';
import { SQL_ICON_STROKE } from './sqlIconStyle';
import { TableBlueprintModal, type BlueprintMode } from './TableBlueprintModal';

/** Categories shown in the SQL Editor schema browser (order = display order). */
const EXPLORER_GROUPS: { type: DbObjectType; title: string }[] = [
  { type: 'TABLE', title: 'Tables' },
  { type: 'VIEW', title: 'Views' },
  { type: 'MQT', title: 'MQTs' },
  { type: 'PROCEDURE', title: 'Procedures' },
  { type: 'FUNCTION', title: 'Functions' },
];

const EXPLORER_CONN_KEY = 'foxschema-sql-schema-explorer-connection';

function readStoredExplorerId(): string {
  try {
    return localStorage.getItem(EXPLORER_CONN_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function writeStoredExplorerId(id: string): void {
  try {
    if (id) localStorage.setItem(EXPLORER_CONN_KEY, id);
    else localStorage.removeItem(EXPLORER_CONN_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Slim schema tree for the SQL Editor. Categorized TABLE / VIEW / MQT /
 * PROCEDURE / FUNCTION — click a name to insert at the Monaco cursor.
 */
export const SqlSchemaExplorer: React.FC = () => {
  const connections = useSyncStore((s) => s.connections);
  const tabs = useSqlEditorStore((s) => s.tabs);
  const activeTabId = useSqlEditorStore((s) => s.activeTabId);
  const schemaCache = useSqlEditorStore((s) => s.schemaCache);
  const ensureSchema = useSqlEditorStore((s) => s.ensureSchema);
  const shareDestinations = useSqlEditorStore((s) => s.shareDestinations);
  const sharedConnectionIds = useSqlEditorStore((s) => s.sharedConnectionIds);

  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
  const preferredIds = effectiveConnectionIds(tab, shareDestinations, sharedConnectionIds).filter(
    (id) => connections.some((c) => c.id === id)
  );

  const [explorerId, setExplorerId] = useState<string>(() => readStoredExplorerId());
  const [expandedObj, setExpandedObj] = useState<Record<string, boolean>>({});
  const [expandedGroup, setExpandedGroup] = useState<Record<string, boolean>>({
    TABLE: true,
    VIEW: true,
    MQT: true,
    PROCEDURE: true,
    FUNCTION: true,
  });
  const [blueprintTable, setBlueprintTable] = useState<TableSchema | null>(null);
  const [blueprintMode, setBlueprintMode] = useState<BlueprintMode>('edit');

  const selectExplorerId = (id: string) => {
    setExplorerId(id);
    writeStoredExplorerId(id);
  };

  useEffect(() => {
    if (explorerId && connections.some((c) => c.id === explorerId)) {
      // Keep a valid selection in storage (e.g. after first hydrate).
      writeStoredExplorerId(explorerId);
      return;
    }
    const stored = readStoredExplorerId();
    const next =
      (stored && connections.some((c) => c.id === stored) ? stored : '') ||
      preferredIds[0] ||
      connections[0]?.id ||
      '';
    if (next !== explorerId) setExplorerId(next);
    if (next) writeStoredExplorerId(next);
  }, [connections, preferredIds, explorerId]);

  useEffect(() => {
    if (!explorerId) return;
    void ensureSchema(explorerId);
  }, [explorerId, ensureSchema]);

  const entry = explorerId ? schemaCache[explorerId] : undefined;
  const grouped = useMemo(() => {
    const list = entry?.tables ?? [];
    const map = new Map<DbObjectType, TableSchema[]>();
    for (const g of EXPLORER_GROUPS) map.set(g.type, []);
    for (const t of list) {
      const bucket = map.get(t.objectType);
      if (bucket) bucket.push(t);
    }
    for (const items of map.values()) {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [entry?.tables]);

  const totalCount = useMemo(
    () => EXPLORER_GROUPS.reduce((n, g) => n + (grouped.get(g.type)?.length ?? 0), 0),
    [grouped]
  );

  const conn = connections.find((c) => c.id === explorerId);

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1" data-testid="sql-schema-explorer">
      {connections.length === 0 ? (
        <p className="text-xs font-medium text-slate-500">Save a connection to browse its tables.</p>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <select
              value={explorerId}
              onChange={(e) => selectExplorerId(e.target.value)}
              className="flex-1 min-w-0 bg-slate-950/80 border border-slate-700 rounded-md px-2 py-1 text-[12px] font-semibold text-slate-200 outline-none focus:border-cyan-600"
              aria-label="Schema connection"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.dialect}] {c.name || '(unnamed)'}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Create new table"
              disabled={!explorerId}
              data-testid="sql-new-table"
              onClick={() => {
                setBlueprintMode('create');
                setBlueprintTable(null);
              }}
              className="p-1.5 rounded text-slate-500 hover:text-emerald-300 hover:bg-slate-800/70 disabled:opacity-40 transition"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" strokeWidth={SQL_ICON_STROKE} />
            </button>
            <button
              type="button"
              title="Reload schema"
              disabled={!explorerId || entry?.status === 'loading'}
              onClick={() => explorerId && void ensureSchema(explorerId, { force: true })}
              className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/70 disabled:opacity-40 transition"
            >
              {entry?.status === 'loading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" strokeWidth={SQL_ICON_STROKE} />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" strokeWidth={SQL_ICON_STROKE} />
              )}
            </button>
          </div>

          {entry?.status === 'error' && (
            <p className="text-[11px] text-rose-400 break-words font-medium">{entry.error}</p>
          )}
          {entry?.status === 'loading' && totalCount === 0 && (
            <p className="text-[12px] font-medium text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-cyan-400" strokeWidth={SQL_ICON_STROKE} /> Loading…
            </p>
          )}
          {entry?.status === 'ready' && totalCount === 0 && (
            <p className="text-[12px] font-medium text-slate-500">
              No tables, views, procedures, or functions in this schema.
            </p>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-0.5">
            {EXPLORER_GROUPS.map((g) => {
              const items = grouped.get(g.type) ?? [];
              if (items.length === 0) return null;
              const open = expandedGroup[g.type] !== false;
              const meta = TYPE_META[g.type];
              return (
                <div key={g.type} data-testid={`sql-schema-group-${g.type}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGroup((m) => ({ ...m, [g.type]: !open }))
                    }
                    className="w-full flex items-center gap-1.5 px-0.5 py-1 text-left sticky top-0 bg-slate-900 z-[1]"
                  >
                    {open ? (
                      <ChevronDown className="w-4 h-4 text-emerald-400 shrink-0" strokeWidth={SQL_ICON_STROKE} />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0" strokeWidth={SQL_ICON_STROKE} />
                    )}
                    <span className="shrink-0">{meta.icon}</span>
                    <span className={`text-[12px] font-bold uppercase tracking-wider ${meta.color}`}>
                      {g.title}
                    </span>
                    <span className="text-[12px] font-mono text-slate-500">({items.length})</span>
                    <span className="flex-1 h-px bg-slate-800/80 ml-1" />
                  </button>
                  {open && (
                    <div className="flex flex-col gap-0.5">
                      {items.map((t) => (
                        <ObjectNode
                          key={`${t.objectType}:${t.name}`}
                          table={t}
                          open={!!expandedObj[`${t.objectType}:${t.name}`]}
                          onToggle={() =>
                            setExpandedObj((m) => {
                              const k = `${t.objectType}:${t.name}`;
                              return { ...m, [k]: !m[k] };
                            })
                          }
                          dialect={conn?.dialect ?? 'sql'}
                          onOpenBlueprint={
                            t.objectType === 'TABLE' || t.objectType === 'MQT'
                              ? () => {
                                  setBlueprintMode('edit');
                                  setBlueprintTable(t);
                                }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(blueprintMode === 'create' || blueprintTable) && explorerId && (
            <TableBlueprintModal
              connectionId={explorerId}
              table={blueprintTable}
              mode={blueprintMode}
              dialect={conn?.dialect ?? 'sql'}
              onClose={() => {
                setBlueprintTable(null);
                setBlueprintMode('edit');
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

const ObjectNode: React.FC<{
  table: TableSchema;
  open: boolean;
  onToggle: () => void;
  dialect: string;
  onOpenBlueprint?: () => void;
}> = ({ table, open, onToggle, dialect, onOpenBlueprint }) => {
  const meta = TYPE_META[table.objectType] ?? TYPE_META.TABLE;
  const insertName = quoteIfNeeded(table.name, dialect);
  const isRoutine = table.objectType === 'PROCEDURE' || table.objectType === 'FUNCTION';
  const params = isRoutine ? filterCallParameters(table.parameters ?? []) : [];
  const columns = !isRoutine
    ? (table.columns ?? []).map((c) => ({ name: c.name, detail: c.type }))
    : [];

  const insertObject = () => {
    if (isRoutine) {
      insertAtCursor(routineInsertText(insertName, table.objectType, params));
      return;
    }
    insertAtCursor(`${insertName} `);
  };

  const insertIdent = (name: string) => {
    insertAtCursor(`${quoteIfNeeded(name, dialect)} `);
  };

  return (
    <div>
      <div className="flex items-center gap-0.5 group">
        <button
          type="button"
          onClick={onToggle}
          className="p-0.5 text-slate-500 hover:text-slate-300"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-sky-400" strokeWidth={SQL_ICON_STROKE} />
          ) : (
            <ChevronRight className="w-4 h-4 text-sky-400" strokeWidth={SQL_ICON_STROKE} />
          )}
        </button>
        <button
          type="button"
          title={
            isRoutine
              ? `Insert ${table.name}(${params.map((p) => `${p.mode} ${p.name}`).join(', ')})`
              : `Insert ${table.name}`
          }
          onClick={insertObject}
          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-[13px] font-semibold text-slate-200 hover:text-cyan-300 py-1 truncate"
        >
          <span className="shrink-0">{meta.icon}</span>
          <span className="truncate font-mono font-bold">{table.name}</span>
          {isRoutine && params.length > 0 && (
            <span className="shrink-0 text-[11px] font-mono font-medium text-slate-500 truncate max-w-[40%]">
              ({params.length})
            </span>
          )}
        </button>
        {onOpenBlueprint && (
          <button
            type="button"
            title="Open table blueprint"
            data-testid="sql-open-blueprint"
            onClick={(e) => {
              e.stopPropagation();
              onOpenBlueprint();
            }}
            className="p-1 rounded text-slate-500 hover:text-violet-300 hover:bg-slate-800/80 opacity-70 group-hover:opacity-100 transition shrink-0"
          >
            <Columns3 className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
          </button>
        )}
      </div>
      {open && isRoutine && params.length === 0 && (
        <p className="ml-6 text-[12px] text-slate-600 mb-1">No parameters</p>
      )}
      {open && isRoutine && params.length > 0 && (
        <ul className="ml-6 border-l border-slate-700/80 pl-2.5 flex flex-col gap-0.5 mb-1">
          {params.map((p, i) => (
            <li key={`${p.mode}-${p.name}-${i}`}>
              <button
                type="button"
                title={`Insert ${p.name} (${p.mode})`}
                onClick={() => insertIdent(p.name)}
                className="w-full flex items-center gap-1.5 min-w-0 text-left text-[12.5px] font-mono font-medium text-slate-300 hover:text-cyan-300 truncate py-1"
              >
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border ${modeBadgeClass(p.mode)}`}
                >
                  {p.mode}
                </span>
                <span className="truncate font-bold">{p.name || `(arg ${i + 1})`}</span>
                {p.type ? (
                  <span className="text-slate-500 ml-auto shrink-0 font-sans text-[11px]">{p.type}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !isRoutine && columns.length > 0 && (
        <ul className="ml-6 border-l border-slate-700/80 pl-2.5 flex flex-col gap-0.5 mb-1">
          {columns.map((col) => (
            <li key={col.name}>
              <button
                type="button"
                title={`Insert ${col.name}`}
                onClick={() => insertIdent(col.name)}
                className="w-full text-left text-[12.5px] font-mono font-medium text-slate-300 hover:text-cyan-300 truncate py-1"
              >
                {col.name}
                {col.detail ? (
                  <span className="text-slate-500 ml-1.5 font-sans text-[12px]">{col.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

function modeBadgeClass(mode: string): string {
  if (mode === 'OUT') return 'bg-amber-950/50 text-amber-300 border-amber-500/35';
  if (mode === 'INOUT') return 'bg-violet-950/50 text-violet-300 border-violet-500/35';
  return 'bg-cyan-950/50 text-cyan-300 border-cyan-500/35';
}

function routineInsertText(
  name: string,
  objectType: string,
  params: NonNullable<TableSchema['parameters']>
): string {
  const args = params
    .map((p) => {
      const label = p.name || p.mode;
      return `/* ${p.mode} ${label} */ ?`;
    })
    .join(', ');
  const callBody = args ? `(${args})` : '()';
  if (objectType === 'PROCEDURE') return `CALL ${name}${callBody}`;
  return `${name}${callBody}`;
}

function quoteIfNeeded(name: string, dialect: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  const d = dialect.toLowerCase();
  if (d === 'mysql' || d === 'mariadb' || d === 'clickhouse') {
    return '`' + name.replace(/`/g, '``') + '`';
  }
  if (d === 'sqlserver') {
    return '[' + name.replace(/]/g, ']]') + ']';
  }
  return '"' + name.replace(/"/g, '""') + '"';
}
