import React from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Database, Link2, RefreshCw, AlertCircle, CheckCircle2, ChevronRight, Zap, Settings } from 'lucide-react';
import { DbObjectType } from '../../backend/interfaces/schema-provider.interface';

export const TopToolbar: React.FC = () => {
  const {
    sourceConfig,
    targetConfig,
    setSourceConfig,
    setTargetConfig,
    isTestingSource,
    isTestingTarget,
    sourceConnected,
    targetConnected,
    testSourceConnection,
    testTargetConnection,
    isComparing,
    runSchemaComparison,
    compareResult,
    resetSync,
    selectedObjectTypes,
    toggleObjectTypeFilter,
  } = useSyncStore();

  const objectScopeOptions: { type: DbObjectType; label: string }[] = [
    { type: 'TABLE', label: 'Tables' },
    { type: 'VIEW', label: 'Views' },
    { type: 'FUNCTION', label: 'Functions' },
    { type: 'PROCEDURE', label: 'Procedures' },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-6 py-4 flex flex-col gap-4">
      {/* Brand Logo & Actions */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-500 p-2 rounded-lg text-slate-950 font-bold shadow-lg shadow-cyan-500/10">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">
              SchemaSync Lite
            </h1>
            <p className="text-xs text-slate-400 font-medium">Enterprise Database Schema Compare & Sync</p>
          </div>
        </div>

        {compareResult && (
          <button
            onClick={resetSync}
            className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600 rounded-md transition cursor-pointer"
          >
            Clear Comparison
          </button>
        )}
      </div>

      {/* Database Connection Control Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Source Configuration */}
        <div className="lg:col-span-5 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></span>
              Source Database
            </span>
            <span className="text-xs text-slate-500">Extract reference structure</span>
          </div>

          <div className="grid grid-cols-12 gap-2">
            <select
              value={sourceConfig.dialect}
              onChange={(e) => setSourceConfig({ dialect: e.target.value as any })}
              className="col-span-3 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="postgres">Postgres</option>
              <option value="mysql">MySQL</option>
              <option value="db2">IBM DB2 (SYSCAT)</option>
            </select>

            <input
              type="text"
              value={sourceConfig.connectionString}
              onChange={(e) => setSourceConfig({ connectionString: e.target.value })}
              placeholder="Host / connection URL"
              className="col-span-6 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono overflow-ellipsis"
            />

            <input
              type="text"
              value={sourceConfig.schema}
              onChange={(e) => setSourceConfig({ schema: e.target.value })}
              placeholder="Schema"
              className="col-span-3 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-between items-center mt-1">
            <button
              onClick={testSourceConnection}
              disabled={isTestingSource}
              className="text-xs text-slate-300 hover:text-slate-100 flex items-center gap-1 hover:bg-slate-900 px-2 py-0.5 rounded transition cursor-pointer"
            >
              {isTestingSource ? 'Connecting...' : 'Test Connection'}
            </button>

            {sourceConnected ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3 h-3" /> Unconnected
              </span>
            )}
          </div>
        </div>

        {/* Link Interconnect Visual */}
        <div className="hidden lg:flex lg:col-span-2 justify-center items-center text-slate-600">
          <div className="flex flex-col items-center">
            <Link2 className="w-5 h-5 animate-pulse text-indigo-500/80" />
            <ChevronRight className="w-4 h-4 text-slate-700 -mt-1" />
          </div>
        </div>

        {/* Target Configuration */}
        <div className="lg:col-span-5 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-purple-400 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse"></span>
              Target Database
            </span>
            <span className="text-xs text-slate-500">Apply migrations here</span>
          </div>

          <div className="grid grid-cols-12 gap-2">
            <select
              value={targetConfig.dialect}
              onChange={(e) => setTargetConfig({ dialect: e.target.value as any })}
              className="col-span-3 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="postgres">Postgres</option>
              <option value="mysql">MySQL</option>
              <option value="db2">IBM DB2 (SYSCAT)</option>
            </select>

            <input
              type="text"
              value={targetConfig.connectionString}
              onChange={(e) => setTargetConfig({ connectionString: e.target.value })}
              placeholder="Host / connection URL"
              className="col-span-6 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-purple-500 font-mono overflow-ellipsis"
            />

            <input
              type="text"
              value={targetConfig.schema}
              onChange={(e) => setTargetConfig({ schema: e.target.value })}
              placeholder="Schema"
              className="col-span-3 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="flex justify-between items-center mt-1">
            <button
              onClick={testTargetConnection}
              disabled={isTestingTarget}
              className="text-xs text-slate-300 hover:text-slate-100 flex items-center gap-1 hover:bg-slate-900 px-2 py-0.5 rounded transition cursor-pointer"
            >
              {isTestingTarget ? 'Connecting...' : 'Test Connection'}
            </button>

            {targetConnected ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3 h-3" /> Unconnected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Target Scope Selection & Trigger Bar */}
      <div className="flex flex-col md:flex-row justify-between md:items-center bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 px-4 gap-3">
        {/* Scope Config Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 uppercase tracking-wider border-r border-slate-800 pr-3">
            <Settings className="w-3.5 h-3.5 text-cyan-400" /> Comparison Scope:
          </span>
          <div className="flex items-center gap-2">
            {objectScopeOptions.map((opt) => {
              const active = selectedObjectTypes.includes(opt.type);
              return (
                <button
                  key={opt.type}
                  onClick={() => toggleObjectTypeFilter(opt.type)}
                  className={`px-3 py-1 rounded text-xs font-semibold border transition cursor-pointer ${
                    active
                      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                      : 'bg-slate-900/50 text-slate-500 border-slate-850 hover:text-slate-450 hover:bg-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={runSchemaComparison}
          disabled={isComparing || !sourceConnected || !targetConnected || selectedObjectTypes.length === 0}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition shadow-lg ${
            sourceConnected && targetConnected && selectedObjectTypes.length > 0
              ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 shadow-indigo-500/10 cursor-pointer'
              : 'bg-slate-850 text-slate-500 cursor-not-allowed border border-slate-800/50'
          }`}
        >
          {isComparing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing Schema...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 fill-current" /> Compare Schemas
            </>
          )}
        </button>
      </div>
    </header>
  );
};
