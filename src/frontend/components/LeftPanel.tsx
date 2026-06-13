import React, { useState } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Search, Layers, Table2, Eye, FunctionSquare, SquareTerminal, Zap, Hash, Box } from 'lucide-react';
import { TableDiff } from '../../backend/types/diff.types';
import { DbObjectType } from '../../backend/interfaces/schema-provider.interface';

const TYPE_META: Record<DbObjectType, { label: string; group: string; color: string; bg: string; icon: React.ReactNode }> = {
  TABLE: {
    label: 'Table',
    group: 'Tables',
    color: 'text-cyan-400',
    bg: 'bg-cyan-950/40 border-cyan-500/20',
    icon: <Table2 className="w-4 h-4 text-cyan-400" />,
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
};

const TYPE_ORDER: DbObjectType[] = ['TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'SEQUENCE', 'TYPE'];

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

export const LeftPanel: React.FC = () => {
  const {
    compareResult,
    selectedTable,
    setSelectedTable,
    filterStatus,
    setFilterStatus,
    searchTerm,
    setSearchTerm,
    syncSelection,
    toggleSyncSelection,
    setAllSyncSelection
  } = useSyncStore();

  const [panelWidth, setPanelWidth] = useState(340);
  const [typeFilter, setTypeFilter] = useState<'ALL' | DbObjectType>('ALL');
  // Unchanged objects are hidden by default — most comparisons only care about diffs
  const [showUnchanged, setShowUnchanged] = useState(false);

  const toggleShowUnchanged = () => {
    const next = !showUnchanged;
    setShowUnchanged(next);
    // Leaving "show unchanged" off while it's the active filter would hide everything
    if (!next && filterStatus === 'UNCHANGED') setFilterStatus('ALL');
  };

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
          Connect to databases and click "Compare Schemas" to view difference tree.
        </p>
      </div>
    );
  }

  const changedTables = compareResult.tables.filter((t) => t.status !== 'UNCHANGED');
  const changedCount = changedTables.length;
  const includedCount = changedTables.filter((t) => syncSelection[t.tableName]).length;

  // Filter by search text, status, object type, and the unchanged toggle
  const filteredTables = compareResult.tables.filter((table) => {
    if (!showUnchanged && table.status === 'UNCHANGED') return false;
    const matchesSearch = table.tableName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'ALL' || table.status === filterStatus;
    const matchesType = typeFilter === 'ALL' || table.objectType === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const statusOptions = (['ALL', 'ADDED', 'REMOVED', 'MODIFIED', 'UNCHANGED'] as const).filter(
    (s) => s !== 'UNCHANGED' || showUnchanged
  );

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
      case 'ADDED':
        return 'bg-emerald-950/60 text-emerald-400 border-emerald-500/20';
      case 'REMOVED':
        return 'bg-rose-950/60 text-rose-400 border-rose-500/20';
      case 'MODIFIED':
        return 'bg-amber-950/60 text-amber-400 border-amber-500/20';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700/30';
    }
  };

  const getChangeSummaryStats = () => {
    const { added, removed, modified, unchanged } = compareResult.summary;
    return [
      { label: 'Added', count: added, color: 'text-emerald-400' },
      { label: 'Removed', count: removed, color: 'text-rose-400' },
      { label: 'Modified', count: modified, color: 'text-amber-400' },
      { label: 'Unchanged', count: unchanged, color: 'text-slate-400' },
    ];
  };

  return (
    <div
      style={{ width: panelWidth }}
      className="relative shrink-0 border-r border-slate-800 bg-slate-905 flex flex-col h-full select-none"
    >
      {/* Overview Stats Dashboard */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Comparison Scope</h2>
          <span className="text-xs text-slate-500 font-mono">
            {compareResult.tables.length} objects
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {getChangeSummaryStats().map((stat, idx) => (
            <div
              key={idx}
              className="bg-slate-950/80 border border-slate-800/50 p-2 rounded flex flex-col items-center justify-center text-center"
            >
              <span className={`text-lg font-extrabold ${stat.color}`}>{stat.count}</span>
              <span className="text-[10px] text-slate-500 font-medium">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Filter / Search Bar */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-950/20 flex flex-col gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search objects..."
            className="w-full text-sm pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-md focus:outline-none focus:border-cyan-500 text-slate-200"
          />
        </div>

        {/* Object Type Filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['ALL', ...TYPE_ORDER] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`text-xs font-bold px-3 py-1.5 rounded-md transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                typeFilter === type
                  ? 'bg-slate-800 text-slate-100 border border-slate-600'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {type !== 'ALL' && <span className={TYPE_META[type].color}>{TYPE_META[type].icon}</span>}
              {type === 'ALL' ? 'All' : TYPE_META[type].group}
              <span className="text-slate-500">{typeCounts(type)}</span>
            </button>
          ))}
        </div>

        {/* Status Filter + Show Unchanged toggle */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusOptions.map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`text-xs font-bold px-3 py-1.5 rounded-md transition whitespace-nowrap cursor-pointer ${
                  filterStatus === status
                    ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-slate-100 border border-cyan-500/20 shadow'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <label
            title="Include unchanged objects in the list"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 whitespace-nowrap cursor-pointer shrink-0 pb-1"
          >
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={toggleShowUnchanged}
              className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer"
            />
            Unchanged
          </label>
        </div>
      </div>

      {/* Deployment Selection Header */}
      <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-950/30 flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-400 uppercase tracking-wider">
          <input
            type="checkbox"
            checked={changedCount > 0 && includedCount === changedCount}
            onChange={(e) => setAllSyncSelection(e.target.checked)}
            className="w-4 h-4 accent-cyan-500 cursor-pointer"
          />
          Deploy to Target
        </label>
        <span className="text-xs text-slate-500 font-mono">
          {includedCount} / {changedCount} included
        </span>
      </div>

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
                  return (
                    <div
                      key={table.tableName}
                      onClick={() => setSelectedTable(table)}
                      className={`group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer ${
                        isSelected
                          ? 'bg-slate-800/80 border-slate-700/80 shadow-md shadow-indigo-500/5'
                          : 'bg-slate-950/30 border-transparent hover:border-slate-800/80 hover:bg-slate-900/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {table.status !== 'UNCHANGED' ? (
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
                        <span className={`text-sm font-semibold truncate ${isSelected ? 'text-slate-100' : 'text-slate-300 group-hover:text-slate-200'}`}>
                          {table.tableName}
                        </span>
                      </div>

                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ml-2 ${getStatusBadge(table.status)}`}>
                        {table.status}
                      </span>
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
