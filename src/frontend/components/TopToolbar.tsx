import React, { useState, useEffect } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Database, Link2, RefreshCw, AlertCircle, CheckCircle2, ChevronRight, Zap, Settings, Plus, Download, HelpCircle } from 'lucide-react';
import { DbObjectType } from '../../backend/interfaces/schema-provider.interface';
import { PROVIDER_SETTINGS } from '../../backend/providers/provider-settings';
import { ConnectionModal } from './ConnectionModal';

const dialectOptions = Object.values(PROVIDER_SETTINGS);

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
    showConnectionModal,
    setShowConnectionModal,
    addConnection,
    connections,
    selectedSourceConnectionId,
    selectedTargetConnectionId,
    applySavedConnection,
    sourceDriverInfo,
    targetDriverInfo,
    isInstallingDriver,
    checkDrivers,
    installDriver
  } = useSyncStore();

  const [activeModalTarget, setActiveModalTarget] = useState<'source' | 'target' | null>(null);

  // Auto-run driver check on mount
  useEffect(() => {
    checkDrivers();
  }, []);

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
      <div className="grid grid-cols-1 xl:grid-cols-11 gap-4 items-stretch">
        {/* Source Configuration */}
        <div className="xl:col-span-5 bg-slate-950/60 p-4 rounded-lg border border-slate-800/80 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></span>
              Source Database
            </span>
            
            {/* Driver Badge */}
            {sourceDriverInfo && (
              <div className="flex items-center gap-1.5">
                {sourceDriverInfo.installed ? (
                  <span className="text-[9px] text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-500/10 font-medium">
                    Driver: {sourceDriverInfo.version || 'Installed'}
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-amber-400 bg-amber-950/30 px-2 py-0.5 rounded-full border border-amber-500/10 font-medium flex items-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" /> Driver Missing
                    </span>
                    <button
                      disabled={isInstallingDriver !== null}
                      onClick={() => installDriver('source')}
                      className="text-[9px] font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 px-2 py-0.5 rounded transition flex items-center gap-0.5 cursor-pointer"
                      title="Install driver package automatically"
                    >
                      {isInstallingDriver === sourceConfig.dialect ? (
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <Download className="w-2.5 h-2.5" />
                      )}
                      Install
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-12 gap-2">
            <select
              value={sourceConfig.dialect}
              onChange={(e) => setSourceConfig({ dialect: e.target.value as any })}
              className="col-span-4 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              {dialectOptions.map((d) => (
                <option key={d.dialect} value={d.dialect}>{d.label}</option>
              ))}
            </select>

            <input
              type="text"
              value={sourceConfig.schema}
              onChange={(e) => setSourceConfig({ schema: e.target.value })}
              placeholder="Schema"
              className="col-span-5 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500"
            />

            <button
              onClick={() => {
                setActiveModalTarget('source');
                setShowConnectionModal(true);
              }}
              title="Configure Credentials"
              className="col-span-3 text-xs bg-slate-800 border border-slate-700 hover:bg-slate-700 text-cyan-400 rounded transition cursor-pointer flex items-center justify-center gap-1 py-1"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Params</span>
            </button>
          </div>

          {/* Saved Connections */}
          {connections.length > 0 && (
            <select
              value={selectedSourceConnectionId ?? ''}
              onChange={(e) => e.target.value && applySavedConnection('source', e.target.value)}
              className="w-full text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">— Saved connections —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.dialect.toUpperCase()}] {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Wider Connection String Field */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Connection String</label>
            <input
              type="text"
              value={sourceConfig.option.connectionString || ''}
              onChange={(e) => setSourceConfig({ option: { ...sourceConfig.option, connectionString: e.target.value } })}
              placeholder="scheme://user:pass@host:port/database"
              className="w-full text-xs bg-slate-900 border border-slate-700/60 rounded px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono overflow-ellipsis"
            />
          </div>

          <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-900">
            <button
              onClick={testSourceConnection}
              disabled={isTestingSource}
              className="text-xs text-slate-350 hover:text-slate-100 flex items-center gap-1 hover:bg-slate-900 px-3 py-1 rounded border border-slate-800 transition cursor-pointer"
            >
              {isTestingSource ? 'Testing...' : 'Test Connection'}
            </button>

            {sourceConnected ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-500/20 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Connected
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-medium px-2 py-1">
                <AlertCircle className="w-3.5 h-3.5" /> Unconnected
              </span>
            )}
          </div>
        </div>

        {/* Link Interconnect Visual */}
        <div className="hidden xl:flex xl:col-span-1 justify-center items-center text-slate-650">
          <div className="flex flex-col items-center">
            <Link2 className="w-6 h-6 animate-pulse text-indigo-500/80" />
            <ChevronRight className="w-5 h-5 text-slate-700 -mt-1" />
          </div>
        </div>

        {/* Target Configuration */}
        <div className="xl:col-span-5 bg-slate-950/60 p-4 rounded-lg border border-slate-800/80 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-purple-400 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse"></span>
              Target Database
            </span>

            {/* Driver Badge */}
            {targetDriverInfo && (
              <div className="flex items-center gap-1.5">
                {targetDriverInfo.installed ? (
                  <span className="text-[9px] text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-500/10 font-medium">
                    Driver: {targetDriverInfo.version || 'Installed'}
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-amber-400 bg-amber-950/30 px-2 py-0.5 rounded-full border border-amber-500/10 font-medium flex items-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" /> Driver Missing
                    </span>
                    <button
                      disabled={isInstallingDriver !== null}
                      onClick={() => installDriver('target')}
                      className="text-[9px] font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 px-2 py-0.5 rounded transition flex items-center gap-0.5 cursor-pointer"
                      title="Install driver package automatically"
                    >
                      {isInstallingDriver === targetConfig.dialect ? (
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <Download className="w-2.5 h-2.5" />
                      )}
                      Install
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-12 gap-2">
            <select
              value={targetConfig.dialect}
              onChange={(e) => setTargetConfig({ dialect: e.target.value as any })}
              className="col-span-4 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
            >
              {dialectOptions.map((d) => (
                <option key={d.dialect} value={d.dialect}>{d.label}</option>
              ))}
            </select>

            <input
              type="text"
              value={targetConfig.schema}
              onChange={(e) => setTargetConfig({ schema: e.target.value })}
              placeholder="Schema"
              className="col-span-5 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
            />

            <button
              onClick={() => {
                setActiveModalTarget('target');
                setShowConnectionModal(true);
              }}
              title="Configure Credentials"
              className="col-span-3 text-xs bg-slate-800 border border-slate-700 hover:bg-slate-700 text-purple-405 rounded transition cursor-pointer flex items-center justify-center gap-1 py-1"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Params</span>
            </button>
          </div>

          {/* Saved Connections */}
          {connections.length > 0 && (
            <select
              value={selectedTargetConnectionId ?? ''}
              onChange={(e) => e.target.value && applySavedConnection('target', e.target.value)}
              className="w-full text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">— Saved connections —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.dialect.toUpperCase()}] {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Wider Connection String Field */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Connection String</label>
            <input
              type="text"
              value={targetConfig.option.connectionString || ''}
              onChange={(e) => setTargetConfig({ option: { ...targetConfig.option, connectionString: e.target.value } })}
              placeholder="scheme://user:pass@host:port/database"
              className="w-full text-xs bg-slate-900 border border-slate-700/60 rounded px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono overflow-ellipsis"
            />
          </div>

          <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-900">
            <button
              onClick={testTargetConnection}
              disabled={isTestingTarget}
              className="text-xs text-slate-350 hover:text-slate-100 flex items-center gap-1 hover:bg-slate-900 px-3 py-1 rounded border border-slate-800 transition cursor-pointer"
            >
              {isTestingTarget ? 'Testing...' : 'Test Connection'}
            </button>

            {targetConnected ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-500/20 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Connected
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-medium px-2 py-1">
                <AlertCircle className="w-3.5 h-3.5" /> Unconnected
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

      <ConnectionModal
        open={showConnectionModal}
        dialect={activeModalTarget === 'target' ? targetConfig.dialect : sourceConfig.dialect}
        initialOptions={activeModalTarget === 'target' ? targetConfig.option : sourceConfig.option}
        onClose={() => {
          setShowConnectionModal(false);
          setActiveModalTarget(null);
        }}
        onSave={(options) => {
          const dialect = activeModalTarget === 'target' ? targetConfig.dialect : sourceConfig.dialect;
          // MySQL has no separate schema concept — the database is the schema
          const schema = options.schema || (dialect === 'mysql' ? options.database : undefined);
          if (activeModalTarget === 'target') {
            setTargetConfig({ option: options, ...(schema ? { schema } : {}) });
          } else {
            setSourceConfig({ option: options, ...(schema ? { schema } : {}) });
          }
          addConnection({
            id: crypto.randomUUID(),
            name: options.database
              ? `${options.host}/${options.database}`
              : options.connectionString ?? 'New Connection',
            dialect: activeModalTarget === 'target' ? targetConfig.dialect : sourceConfig.dialect,
            option: options,
          });
        }}
      />
    </header>
  );
};
