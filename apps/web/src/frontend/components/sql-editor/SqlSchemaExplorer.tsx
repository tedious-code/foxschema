import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { effectiveConnectionIds } from '../../store/sqlEditorTabLogic';
import { TYPE_META } from '../SchemaTreePanel';
import { insertAtCursor } from './sqlEditorBridge';
import type { TableSchema } from '../../lib/types';

/**
 * Slim schema tree for the SQL Editor (not SchemaTreePanel — that one is
 * hard-wired to compare/diff state). Pick a connection, load TABLE/VIEW/MQT,
 * click a name to insert at the Monaco cursor.
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Prefer first checked credential; fall back to first saved connection.
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
  const tables = useMemo(() => {
    const list = entry?.tables ?? [];
    return list
      .filter((t) => t.objectType === 'TABLE' || t.objectType === 'VIEW' || t.objectType === 'MQT')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entry?.tables]);

  const conn = connections.find((c) => c.id === explorerId);

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1" data-testid="sql-schema-explorer">
      {connections.length === 0 ? (
        <p className="text-xs text-slate-500">Save a connection to browse its tables.</p>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <select
              value={explorerId}
              onChange={(e) => setExplorerId(e.target.value)}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-600"
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
              className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 disabled:opacity-40 transition"
            >
              {entry?.status === 'loading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {entry?.status === 'error' && (
            <p className="text-[11px] text-rose-400 break-words">{entry.error}</p>
          )}
          {entry?.status === 'loading' && tables.length === 0 && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </p>
          )}
          {entry?.status === 'ready' && tables.length === 0 && (
            <p className="text-[11px] text-slate-500">No tables or views in this schema.</p>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
            {tables.map((t) => (
              <TableNode
                key={t.name}
                table={t}
                open={!!expanded[t.name]}
                onToggle={() => setExpanded((m) => ({ ...m, [t.name]: !m[t.name] }))}
                dialect={conn?.dialect ?? 'sql'}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const TableNode: React.FC<{
  table: TableSchema;
  open: boolean;
  onToggle: () => void;
  dialect: string;
}> = ({ table, open, onToggle, dialect }) => {
  const meta = TYPE_META[table.objectType] ?? TYPE_META.TABLE;
  const insertName = quoteIfNeeded(table.name, dialect);

  return (
    <div>
      <div className="flex items-center gap-0.5 group">
        <button
          type="button"
          onClick={onToggle}
          className="p-0.5 text-slate-600 hover:text-slate-300"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <button
          type="button"
          title={`Insert ${table.name}`}
          onClick={() => insertAtCursor(`${insertName} `)}
          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-[11px] text-slate-300 hover:text-cyan-300 py-0.5 truncate"
        >
          <span className="shrink-0 scale-90">{meta.icon}</span>
          <span className="truncate font-mono">{table.name}</span>
        </button>
      </div>
      {open && (
        <ul className="ml-5 border-l border-slate-800/80 pl-2 flex flex-col gap-0.5 mb-1">
          {(table.columns ?? []).map((col) => (
            <li key={col.name}>
              <button
                type="button"
                title={`Insert ${col.name}`}
                onClick={() => insertAtCursor(`${quoteIfNeeded(col.name, dialect)} `)}
                className="w-full text-left text-[10px] font-mono text-slate-500 hover:text-cyan-300 truncate py-0.5"
              >
                {col.name}
                <span className="text-slate-700 ml-1">{col.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

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
