import React from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Search, Filter, HelpCircle, Layers, FolderPlus, FolderMinus, AlertTriangle } from 'lucide-react';
import { TableDiff } from '../../backend/types/diff.types';

export const LeftPanel: React.FC = () => {
  const {
    compareResult,
    selectedTable,
    setSelectedTable,
    filterStatus,
    setFilterStatus,
    searchTerm,
    setSearchTerm,
  } = useSyncStore();

  if (!compareResult) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 bg-slate-900/30">
        <Layers className="w-10 h-10 mb-3 text-slate-700 animate-bounce" />
        <p className="text-sm font-semibold text-slate-400">No Comparison Active</p>
        <p className="text-xs text-slate-600 text-center max-w-[220px] mt-1">
          Connect to databases and click "Compare Schemas" to view difference tree.
        </p>
      </div>
    );
  }

  // Filter and search logic
  const filteredTables = compareResult.tables.filter((table) => {
    const matchesSearch = table.tableName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'ALL' || table.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusStyle = (status: TableDiff['status']) => {
    switch (status) {
      case 'ADDED':
        return {
          icon: <FolderPlus className="w-4 h-4 text-emerald-400" />,
          badge: 'bg-emerald-950/60 text-emerald-400 border-emerald-500/20',
          text: 'text-emerald-400 hover:bg-emerald-950/20',
          indicator: 'bg-emerald-400',
        };
      case 'REMOVED':
        return {
          icon: <FolderMinus className="w-4 h-4 text-rose-400" />,
          badge: 'bg-rose-950/60 text-rose-400 border-rose-500/20',
          text: 'text-rose-400 hover:bg-rose-950/20',
          indicator: 'bg-rose-400',
        };
      case 'MODIFIED':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
          badge: 'bg-amber-950/60 text-amber-400 border-amber-500/20',
          text: 'text-amber-300 hover:bg-amber-950/20',
          indicator: 'bg-amber-400',
        };
      default:
        return {
          icon: <Layers className="w-4 h-4 text-slate-400" />,
          badge: 'bg-slate-800 text-slate-400 border-slate-700/30',
          text: 'text-slate-400 hover:bg-slate-850',
          indicator: 'bg-slate-600',
        };
    }
  };

  const getChangeSummaryStats = () => {
    const { added, removed, modified, unchanged } = compareResult.summary;
    return [
      { label: 'Added', count: added, color: 'text-emerald-400', bg: 'bg-emerald-400' },
      { label: 'Removed', count: removed, color: 'text-rose-400', bg: 'bg-rose-400' },
      { label: 'Modified', count: modified, color: 'text-amber-400', bg: 'bg-amber-400' },
      { label: 'Unchanged', count: unchanged, color: 'text-slate-400', bg: 'bg-slate-600' },
    ];
  };

  return (
    <div className="w-80 border-r border-slate-800 bg-slate-905 flex flex-col h-full select-none">
      {/* Overview Stats Dashboard */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Comparison Scope</h2>
          <span className="text-[10px] text-slate-500 font-mono">
            {compareResult.tables.length} Total objects
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {getChangeSummaryStats().map((stat, idx) => (
            <div
              key={idx}
              className="bg-slate-950/80 border border-slate-800/50 p-2 rounded flex flex-col items-center justify-center text-center"
            >
              <span className={`text-base font-extrabold ${stat.color}`}>{stat.count}</span>
              <span className="text-[9px] text-slate-500 font-medium">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Filter / Search Bar */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-950/20 flex flex-col gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search schemas..."
            className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-md focus:outline-none focus:border-cyan-500 text-slate-200"
          />
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1">
          {(['ALL', 'ADDED', 'REMOVED', 'MODIFIED', 'UNCHANGED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`text-[9px] font-bold px-2 py-1 rounded transition whitespace-nowrap cursor-pointer ${
                filterStatus === status
                  ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-slate-100 border border-cyan-500/20 shadow'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Tree Node List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredTables.length === 0 ? (
          <div className="text-center py-8 text-slate-600 text-xs">No matching schema objects.</div>
        ) : (
          filteredTables.map((table) => {
            const styles = getStatusStyle(table.status);
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
                <div className="flex items-center gap-2 min-w-0">
                  {styles.icon}
                  <div className="flex flex-col min-w-0">
                    <span className={`text-xs font-semibold truncate ${isSelected ? 'text-slate-100' : 'text-slate-300 group-hover:text-slate-200'}`}>
                      {table.tableName}
                    </span>
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">
                      {table.objectType === 'PROCEDURE' ? 'SP / PROC' : table.objectType}
                    </span>
                  </div>
                </div>

                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${styles.badge}`}>
                  {table.status}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
