import React, { useState } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Search, Layers, Table2, Eye, FunctionSquare, SquareTerminal, Zap, Hash, Box, Users } from 'lucide-react';
import type { TableDiff, DbObjectType } from '../lib/types';
import { highlightMatch } from '../utils/highlight';

const TYPE_META: Record<DbObjectType, { label: string; group: string; color: string; bg: string; icon: React.ReactNode }> = {
  TABLE: {
    label: 'Table',
    group: 'Tables',
    color: 'text-cyan-400',
    bg: 'bg-cyan-950/40 border-cyan-500/20',
    icon: <Table2 className="w-4 h-4 text-cyan-400" />,
  },
  MQT: {
    label: 'MQT',
    group: 'MQTs',
    color: 'text-emerald-400',
    bg: 'bg-emerald-950/40 border-emerald-500/20',
    icon: <Layers className="w-4 h-4 text-emerald-400" />,
  },
  VIEW: {
    label: 'View',
    group: 'Views',
    color: 'text-violet-400',
    bg: 'bg-violet-950/40 border-violet-500/20',
    icon: <Eye className="w-4 h-4 text-violet-400" />,
  },
  PROCEDURE: {
    label: 'Procedure',
    group: 'Procedures',
    color: 'text-orange-400',
    bg: 'bg-orange-950/40 border-orange-500/20',
    icon: <SquareTerminal className="w-4 h-4 text-orange-400" />,
  },
  FUNCTION: {
    label: 'Function',
    group: 'Functions',
    color: 'text-pink-400',
    bg: 'bg-pink-950/40 border-pink-500/20',
    icon: <FunctionSquare className="w-4 h-4 text-pink-400" />,
  },
  TRIGGER: {
    label: 'Trigger',
    group: 'Triggers',
    color: 'text-yellow-400',
    bg: 'bg-yellow-950/40 border-yellow-500/20',
    icon: <Zap className="w-4 h-4 text-yellow-400" />,
  },
  SEQUENCE: {
    label: 'Sequence',
    group: 'Sequences',
    color: 'text-teal-400',
    bg: 'bg-teal-950/40 border-teal-500/20',
    icon: <Hash className="w-4 h-4 text-teal-400" />,
  },
  TYPE: {
    label: 'Type',
    group: 'Types',
    color: 'text-sky-400',
    bg: 'bg-sky-950/40 border-sky-500/20',
    icon: <Box className="w-4 h-4 text-sky-400" />,
  },
  ROLE: {
    label: 'Role',
    group: 'Roles',
    color: 'text-rose-400',
    bg: 'bg-rose-950/40 border-rose-500/20',
    icon: <Users className="w-4 h-4 text-rose-400" />,
  },
};

const TYPE_ORDER: DbObjectType[] = ['TABLE', 'MQT', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'SEQUENCE', 'TYPE', 'ROLE'];

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

export const SchemaTreePanel: React.FC = () => {
  const {
    compareResult,
    browseMode,
    browseSide,
    sourceConfig,
    targetConfig,
    selectedTable,
    setSelectedTable,
    filterStatus,
    setFilterStatus,
    searchTerm,
    setSearchTerm,
    syncSelection,
    toggleSyncSelection,
    setAllSyncSelection,
    nonDestructive,
    setNonDestructive,
    continueOnError,
    setContinueOnError,
  } = useSyncStore();

  const [panelWidth, setPanelWidth] = useState(340);
  const [typeFilter, setTypeFilter] = useState<'ALL' | DbObjectType>('ALL');
  // "Unchanged" is an independent toggle (not part of the All/Added/Removed/Modified
  // status filter). On by default, so the initial view shows every object.
  const [showUnchanged, setShowUnchanged] = useState(true);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMove = (ev: MouseEvent) => {
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!compareResult) {
    return (
      <div className="w-80 border-r border-slate-800 flex flex-col items-center justify-center text-slate-500 p-6 bg-slate-900/30">
        <Layers className="w-10 h-10 mb-3 text-slate-700 animate-bounce" />
        <p className="text-sm font-semibold text-slate-400">No Comparison Active</p>
        <p className="text-xs text-slate-600 text-center max-w-[220px] mt-1">
          Connect and click "Compare Schemas" to view the difference tree — or "Browse" one side to search its objects.
        </p>
      </div>
    );
  }

  const browseSchemaName = browseSide === 'target' ? targetConfig.schema : sourceConfig.schema;

  const changedTables = compareResult.tables.filter((t) => t.status !== 'UNCHANGED');
  const changedCount = changedTables.length;
  const includedCount = changedTables.filter((t) => syncSelection[t.tableName]).length;

  // Search matches across the whole object schema — the object name, its column,
  // index, foreign-key (and referenced table), and trigger names, plus the DDL
  // definition body. The definition is what makes views, functions, procedures,
  // and triggers searchable, since those objects have no columns of their own.
  const query = searchTerm.trim().toLowerCase();
  const matchesSearch = (table: TableDiff) => {
    if (!query) return true;
    const haystack: (string | undefined)[] = [table.tableName];
    for (const c of table.columnDiffs) haystack.push(c.name);
    for (const i of table.indexDiffs) haystack.push(i.name);
    for (const fk of table.foreignKeyDiffs) {
      haystack.push(fk.name, fk.source?.referencedTable ?? fk.target?.referencedTable);
    }
    for (const tr of table.triggerDiffs ?? []) {
      haystack.push(tr.name, tr.source?.definition, tr.target?.definition);
    }
    // View / function / procedure bodies (and any object-level DDL)
    haystack.push(table.definition, table.sourceTable?.definition, table.targetTable?.definition);
    return haystack.some((s) => s?.toLowerCase().includes(query));
  };

  // When a row matches because of something other than its name, describe
  // where (column / index / FK / trigger / definition) so the result explains
  // why it surfaced. Returns null when the name itself matches (already
  // highlighted) or there's no query.
  const matchLocation = (table: TableDiff): string | null => {
    if (!query || table.tableName.toLowerCase().includes(query)) return null;
    const col = table.columnDiffs.find((c) => c.name.toLowerCase().includes(query));
    if (col) return `column: ${col.name}`;
    const idx = table.indexDiffs.find((i) => i.name.toLowerCase().includes(query));
    if (idx) return `index: ${idx.name}`;
    const fk = table.foreignKeyDiffs.find(
      (f) =>
        f.name.toLowerCase().includes(query) ||
        (f.source?.referencedTable ?? f.target?.referencedTable ?? '').toLowerCase().includes(query)
    );
    if (fk) return `foreign key: ${fk.name}`;
    const tr = (table.triggerDiffs ?? []).find(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        (t.source?.definition ?? '').toLowerCase().includes(query) ||
        (t.target?.definition ?? '').toLowerCase().includes(query)
    );
    if (tr) return `trigger: ${tr.name}`;
    if ([table.definition, table.sourceTable?.definition, table.targetTable?.definition].some((d) => d?.toLowerCase().includes(query)))
      return 'definition';
    return null;
  };

  // Filter by search text, object type, the status filter (All/Added/Removed/
  // Modified), and the independent Unchanged toggle. Unchanged objects appear
  // only while the toggle is on; changed objects follow the status filter.
  const filteredTables = compareResult.tables.filter((table) => {
    if (!matchesSearch(table)) return false;
    if (!(typeFilter === 'ALL' || table.objectType === typeFilter)) return false;
    if (table.status === 'UNCHANGED') return showUnchanged;
    return filterStatus === 'ALL' || table.status === filterStatus;
  });

  // Group the filtered objects by type, in a stable order
  const groups = TYPE_ORDER
    .map((type) => ({ type, items: filteredTables.filter((t) => t.objectType === type) }))
    .filter((g) => g.items.length > 0);

  const typeCounts = (type: 'ALL' | DbObjectType) =>
    type === 'ALL'
      ? compareResult.tables.length
      : compareResult.tables.filter((t) => t.objectType === type).length;

  const getStatusBadge = (status: TableDiff['status']) => {
    switch (status) {
      case 'ADDED':   return 'bg-emerald-950/60 text-emerald-400 border-emerald-500/20';
      case 'REMOVED': return 'bg-rose-950/60 text-rose-400 border-rose-500/20';
      case 'MODIFIED': return 'bg-amber-950/60 text-amber-400 border-amber-500/20';
      default: return 'bg-slate-800 text-slate-400 border-slate-700/30';
    }
  };

  const getChangeSummaryStats = () => {
    const { added, removed, modified, unchanged } = compareResult.summary;
    return [
      { label: 'All',       count: compareResult.tables.length, color: 'text-slate-100',   status: 'ALL'       as const, toggle: false },
      { label: 'Added',     count: added,    color: 'text-emerald-400', status: 'ADDED'     as const, toggle: false },
      { label: 'Removed',   count: removed,  color: 'text-rose-400',   status: 'REMOVED'   as const, toggle: false },
      { label: 'Modified',  count: modified, color: 'text-amber-400',  status: 'MODIFIED'  as const, toggle: false },
      { label: 'Unchanged', count: unchanged,color: 'text-slate-400',  status: 'UNCHANGED' as const, toggle: true  },
    ];
  };

  return (
    <div
      data-testid="schema-tree"
      style={{ width: panelWidth }}
      className="relative shrink-0 border-r border-slate-800 bg-slate-905 flex flex-col h-full select-none"
    >
      {/* Overview Stats Dashboard */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
            {browseMode ? (
              <>Browsing <span className="text-cyan-400 normal-case">{browseSchemaName}</span></>
            ) : (
              'Comparison Scope'
            )}
          </h2>
          <span className="text-sm text-slate-200 font-mono font-bold">
            {compareResult.tables.length} objects
          </span>
        </div>

        {/* Stat cards double as the filter: All/Added/Removed/Modified are a
            single-select status filter; Unchanged is an independent toggle.
            Hidden in browse mode — there are no statuses to filter by. */}
        {!browseMode && (
        <div className="grid grid-cols-5 gap-1.5">
          {getChangeSummaryStats().map((stat) => {
            const active = stat.toggle ? showUnchanged : filterStatus === stat.status;
            return (
              <button
                key={stat.status}
                onClick={() => (stat.toggle ? setShowUnchanged((v) => !v) : setFilterStatus(stat.status))}
                title={stat.toggle ? 'Toggle unchanged objects' : `Show ${stat.label.toLowerCase()}`}
                className={`p-2 rounded border flex flex-col items-center justify-center text-center transition cursor-pointer ${
                  active
                    ? 'bg-slate-800 border-cyan-500/50 ring-1 ring-cyan-500/20'
                    : 'bg-slate-950/80 border-slate-800/50 hover:border-slate-700'
                }`}
              >
                <span className={`text-base font-extrabold leading-none ${stat.color}`}>{stat.count}</span>
                <span className="text-[9px] text-slate-500 font-medium leading-tight mt-1">{stat.label}</span>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* Navigation Filter / Search Bar */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-950/20 flex flex-col gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search objects, columns, indexes..."
            className="w-full text-sm pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-md focus:outline-none focus:border-cyan-500 text-slate-200"
          />
        </div>

        {/* Object Type Filter — card-styled buttons, matching the stat cards */}
        <div className="flex gap-1.5 overflow-x-auto">
          {(['ALL', ...TYPE_ORDER] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`text-xs font-bold px-2.5 py-1.5 rounded transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 border ${
                typeFilter === type
                  ? 'bg-slate-800 text-slate-100 border-slate-600'
                  : 'bg-slate-950/80 text-slate-400 hover:text-slate-200 border-slate-800/50'
              }`}
            >
              {type !== 'ALL' && <span className={TYPE_META[type].color}>{TYPE_META[type].icon}</span>}
              {type === 'ALL' ? 'All' : TYPE_META[type].group}
              <span className="text-slate-500">{typeCounts(type)}</span>
            </button>
          ))}
        </div>

      </div>

      {/* Deployment Selection Header — hidden in browse mode (nothing to deploy) */}
      {!browseMode && (
      <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-950/30 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">
          <input
            type="checkbox"
            checked={changedCount > 0 && includedCount === changedCount}
            onChange={(e) => setAllSyncSelection(e.target.checked)}
            className="w-4 h-4 accent-cyan-500 cursor-pointer"
          />
          Deploy to Target
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <label
            className={`flex items-center gap-1.5 cursor-pointer text-[10px] font-semibold px-2 py-1 rounded border transition ${
              nonDestructive
                ? 'text-emerald-300 bg-emerald-950/50 border-emerald-500/40'
                : 'text-slate-500 bg-slate-950/40 border-slate-800 hover:border-slate-700'
            }`}
            title="Non-destructive: ADD/MODIFY only — never DROP columns, indexes, or tables"
          >
            <input
              data-testid="non-destructive-checkbox"
              type="checkbox"
              checked={nonDestructive}
              onChange={(e) => setNonDestructive(e.target.checked)}
              className="w-3 h-3 accent-emerald-500 cursor-pointer"
            />
            No drops
          </label>
          <label
            className={`flex items-center gap-1.5 cursor-pointer text-[10px] font-semibold px-2 py-1 rounded border transition ${
              continueOnError
                ? 'text-amber-300 bg-amber-950/50 border-amber-500/40'
                : 'text-slate-500 bg-slate-950/40 border-slate-800 hover:border-slate-700'
            }`}
            title="Skip failures: an object that fails to deploy is skipped instead of aborting and rolling back the whole run. Objects depending on a skipped one will likely fail too."
          >
            <input
              data-testid="continue-on-error-checkbox"
              type="checkbox"
              checked={continueOnError}
              onChange={(e) => setContinueOnError(e.target.checked)}
              className="w-3 h-3 accent-amber-500 cursor-pointer"
            />
            Skip failures
          </label>
          <span className="text-xs text-slate-300 font-mono font-bold shrink-0">
            {includedCount} / {changedCount}
          </span>
        </div>
      </div>
      )}

      {/* Tree Node List, grouped by object type */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groups.length === 0 ? (
          <div className="text-center py-8 text-slate-600 text-sm">No matching schema objects.</div>
        ) : (
          groups.map((group) => (
            <div key={group.type}>
              {/* Group Header */}
              <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                {TYPE_META[group.type].icon}
                <span className={`text-xs font-bold uppercase tracking-wider ${TYPE_META[group.type].color}`}>
                  {TYPE_META[group.type].group}
                </span>
                <span className="text-xs text-slate-600 font-mono">({group.items.length})</span>
                <div className="flex-1 h-px bg-slate-800/80" />
              </div>

              <div className="space-y-1">
                {group.items.map((table) => {
                  const isSelected = selectedTable?.tableName === table.tableName;
                  const matchedIn = matchLocation(table);
                  return (
                    <div
                      key={table.tableName}
                      data-testid="diff-item"
                      data-object={table.tableName}
                      data-status={table.status}
                      onClick={() => setSelectedTable(table)}
                      className={`group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer ${
                        isSelected
                          ? 'bg-slate-800/80 border-slate-700/80 shadow-md shadow-indigo-500/5'
                          : 'bg-slate-950/30 border-transparent hover:border-slate-800/80 hover:bg-slate-900/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {browseMode ? null : table.status !== 'UNCHANGED' ? (
                          <input
                            type="checkbox"
                            checked={!!syncSelection[table.tableName]}
                            onChange={() => toggleSyncSelection(table.tableName)}
                            onClick={(e) => e.stopPropagation()}
                            title="Include this change in the deployment script"
                            className="w-4 h-4 accent-cyan-500 cursor-pointer shrink-0"
                          />
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <span className="shrink-0">{TYPE_META[table.objectType].icon}</span>
                        <div className="flex flex-col min-w-0">
                          <span className={`text-sm font-semibold truncate ${isSelected ? 'text-slate-100' : 'text-slate-300 group-hover:text-slate-200'}`}>
                            {highlightMatch(table.tableName, query)}
                          </span>
                          {matchedIn && (
                            <span className="text-[10px] text-slate-500 truncate" title={`Search matched in ${matchedIn}`}>
                              matched in {matchedIn}
                            </span>
                          )}
                        </div>
                      </div>

                      {!browseMode && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ml-2 ${getStatusBadge(table.status)}`}>
                          {table.status}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-cyan-500/40 active:bg-cyan-500/60 transition-colors"
      />
    </div>
  );
};
