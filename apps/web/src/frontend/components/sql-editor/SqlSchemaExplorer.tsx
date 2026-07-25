import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { effectiveConnectionIds } from '../../store/sqlEditorTabLogic';
import { TYPE_META } from '../SchemaTreePanel';
import { filterCallParameters, insertAtCursor } from './sqlEditorBridge';
import type { DbObjectType, TableSchema } from '../../lib/types';

/** Categories shown in the SQL Editor schema browser (order = display order). */
const EXPLORER_GROUPS: { type: DbObjectType; title: string }[] = [
  { type: 'TABLE', title: 'Tables' },
  { type: 'VIEW', title: 'Views' },
  { type: 'MQT', title: 'MQTs' },
  { type: 'PROCEDURE', title: 'Procedures' },
  { type: 'FUNCTION', title: 'Functions' },
];

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

  const [explorerId, setExplorerId] = useState<string>('');
  const [expandedObj, setExpandedObj] = useState<Record<string, boolean>>({});
  const [expandedGroup, setExpandedGroup] = useState<Record<string, boolean>>({
    TABLE: true,
    VIEW: true,
    MQT: true,
    PROCEDURE: true,
    FUNCTION: true,
  });

  useEffect(() => {
    if (explorerId && connections.some((c) => c.id === explorerId)) return;
    const next = preferredIds[0] ?? connections[0]?.id ?? '';
    setExplorerId(next);
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
              onChange={(e) => setExplorerId(e.target.value)}
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
              title="Reload schema"
              disabled={!explorerId || entry?.status === 'loading'}
              onClick={() => explorerId && void ensureSchema(explorerId, { force: true })}
              className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/70 disabled:opacity-40 transition"
            >
              {entry?.status === 'loading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {entry?.status === 'error' && (
            <p className="text-[11px] text-rose-400 break-words font-medium">{entry.error}</p>
          )}
          {entry?.status === 'loading' && totalCount === 0 && (
            <p className="text-[12px] font-medium text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
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
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    )}
                    <span className="shrink-0 scale-90">{meta.icon}</span>
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${meta.color}`}>
                      {g.title}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">({items.length})</span>
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
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
}> = ({ table, open, onToggle, dialect }) => {
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
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          title={
            isRoutine
              ? `Insert ${table.name}(${params.map((p) => `${p.mode} ${p.name}`).join(', ')})`
              : `Insert ${table.name}`
          }
          onClick={insertObject}
          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-[12px] font-semibold text-slate-200 hover:text-cyan-300 py-0.5 truncate"
        >
          <span className="shrink-0 scale-90">{meta.icon}</span>
          <span className="truncate font-mono font-bold">{table.name}</span>
          {isRoutine && params.length > 0 && (
            <span className="shrink-0 text-[10px] font-mono font-medium text-slate-500 truncate max-w-[40%]">
              ({params.length})
            </span>
          )}
        </button>
      </div>
      {open && isRoutine && params.length === 0 && (
        <p className="ml-5 text-[10px] text-slate-600 mb-1">No parameters</p>
      )}
      {open && isRoutine && params.length > 0 && (
        <ul className="ml-5 border-l border-slate-700/80 pl-2 flex flex-col gap-0.5 mb-1">
          {params.map((p, i) => (
            <li key={`${p.mode}-${p.name}-${i}`}>
              <button
                type="button"
                title={`Insert ${p.name} (${p.mode})`}
                onClick={() => insertIdent(p.name)}
                className="w-full flex items-center gap-1.5 min-w-0 text-left text-[11px] font-mono font-medium text-slate-300 hover:text-cyan-300 truncate py-0.5"
              >
                <span
                  className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border ${modeBadgeClass(p.mode)}`}
                >
                  {p.mode}
                </span>
                <span className="truncate font-bold">{p.name || `(arg ${i + 1})`}</span>
                {p.type ? (
                  <span className="text-slate-500 ml-auto shrink-0 font-sans text-[10px]">{p.type}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !isRoutine && columns.length > 0 && (
        <ul className="ml-5 border-l border-slate-700/80 pl-2 flex flex-col gap-0.5 mb-1">
          {columns.map((col) => (
            <li key={col.name}>
              <button
                type="button"
                title={`Insert ${col.name}`}
                onClick={() => insertIdent(col.name)}
                className="w-full text-left text-[11px] font-mono font-medium text-slate-400 hover:text-cyan-300 truncate py-0.5"
              >
                {col.name}
                {col.detail ? (
                  <span className="text-slate-600 ml-1 font-sans">{col.detail}</span>
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
