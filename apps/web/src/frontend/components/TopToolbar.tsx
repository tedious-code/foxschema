import React, { useState } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { ArrowRight, ArrowLeftRight, RefreshCw, AlertCircle, CheckCircle2, Zap, Settings, KeyRound, History, Search } from 'lucide-react';
import { Brand } from './Brand';
import { ProfileMenu } from './ProfileMenu';
import { CredentialManager } from './CredentialManager';
import { MigrationHistory } from './MigrationHistory';
import type { DbObjectType } from '../lib/types';
import { PROVIDER_SETTINGS } from '../lib/provider-settings';
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
    browseSchema,
    isBrowsing,
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
    swapSourceTarget,
  } = useSyncStore();

  const [activeModalTarget, setActiveModalTarget] = useState<'source' | 'target' | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Same dialect + server + database + schema means you'd be comparing a schema
  // with itself (everything UNCHANGED) — almost always a misconfiguration
  const sameConfig =
    sourceConfig.dialect === targetConfig.dialect &&
    (sourceConfig.option.host ?? '') === (targetConfig.option.host ?? '') &&
    (sourceConfig.option.database ?? '') === (targetConfig.option.database ?? '') &&
    sourceConfig.schema.trim().toUpperCase() === targetConfig.schema.trim().toUpperCase();

  const objectScopeOptions: { type: DbObjectType; label: string }[] = [
    { type: 'TABLE', label: 'Tables' },
    { type: 'MQT', label: 'MQTs' },
    { type: 'VIEW', label: 'Views' },
    { type: 'FUNCTION', label: 'Functions' },
    { type: 'PROCEDURE', label: 'Procedures' },
    { type: 'TRIGGER', label: 'Triggers' },
    { type: 'SEQUENCE', label: 'Sequences' },
    { type: 'TYPE', label: 'Types' },
    { type: 'ROLE', label: 'Roles' },
  ];

  return (
    <header data-testid="toolbar" className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-6 py-3 flex flex-col gap-3">
      {/* Brand Logo & Actions */}
      <div className="flex justify-between items-center">
        <Brand logoSize={42} textClassName="text-2xl font-bold" />

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCredentials(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-base font-semibold text-cyan-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/40 rounded-md transition cursor-pointer"
          >
            <KeyRound className="w-4 h-4" /> Credentials
          </button>
          <button
            data-testid="history-btn"
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-base font-semibold text-slate-300 hover:text-slate-100 border border-slate-700 hover:border-slate-500 rounded-md transition cursor-pointer"
          >
            <History className="w-4 h-4" /> History
          </button>
          {compareResult && (
            <button
              onClick={resetSync}
              className="px-3 py-1.5 text-base font-semibold text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600 rounded-md transition cursor-pointer"
            >
              Clear Comparison
            </button>
          )}
          <div className="pl-3 border-l border-slate-800">
            <ProfileMenu />
          </div>
        </div>
      </div>

      {/* Database Connection Control Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-11 gap-3 items-stretch">
        {/* Source Configuration */}
        <div className="xl:col-span-5 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          {/* Label + Add/Edit Connection + status, all inline */}
          <div className="flex items-center gap-2">
            {connections.length > 0 && (
              <select
                value={selectedSourceConnectionId ?? ''}
                onChange={(e) => e.target.value && applySavedConnection('source', e.target.value)}
                title="Saved connections"
                className="shrink-0 w-40 max-w-[160px] text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 truncate"
              >
                <option value="">— Saved —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.dialect.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
            )}

            <span className={`flex-1 min-w-0 text-xs font-bold truncate ${
              sourceConfig.option.database
                ? 'text-cyan-300 font-mono'
                : 'text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-1'
            }`}>
              {sourceConfig.option.database
                ? `${sourceConfig.option.host ?? 'localhost'} / ${sourceConfig.option.database}${sourceConfig.schema ? ` / ${sourceConfig.schema}` : ''}`
                : 'Configure credentials via Params'}
            </span>

            <button
              data-testid="source-config-btn"
              onClick={() => {
                setActiveModalTarget('source');
                setShowConnectionModal(true);
              }}
              title="Add or edit this connection's credentials"
              className="shrink-0 text-xs font-semibold bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:border-cyan-500/40 text-cyan-400 rounded transition cursor-pointer flex items-center gap-1.5 px-3 py-1.5"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{sourceConfig.option.database ? 'Edit' : 'Add'} Connection</span>
            </button>

            {isTestingSource ? (
              <span className="text-base text-cyan-400 flex items-center gap-1 font-medium shrink-0">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting...
              </span>
            ) : sourceConnected ? (
              <button
                data-testid="source-connected-btn"
                onClick={testSourceConnection}
                title="Reconnect and refresh schema list"
                className="group text-base text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-500/20 hover:border-emerald-400/50 hover:bg-emerald-950/70 flex items-center gap-1 font-medium shrink-0 cursor-pointer transition"
              >
                <CheckCircle2 className="w-3.5 h-3.5 group-hover:hidden" />
                <RefreshCw className="w-3.5 h-3.5 hidden group-hover:block" />
                <span className="group-hover:hidden">Connected</span>
                <span className="hidden group-hover:inline">Refresh</span>
              </button>
            ) : (
              <button
                data-testid="source-connect-btn"
                onClick={testSourceConnection}
                title="Retry connection"
                className="text-base text-slate-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/40 bg-slate-900/60 hover:bg-slate-900 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium shrink-0 cursor-pointer transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry Connection
              </button>
            )}

            {sourceConnected && (
              <button
                onClick={() => browseSchema('source')}
                disabled={isBrowsing || selectedObjectTypes.length === 0}
                title="Load this schema's objects to browse and search (no comparison)"
                className="shrink-0 text-base text-cyan-400 border border-cyan-500/30 hover:border-cyan-400/60 bg-cyan-950/30 hover:bg-cyan-950/60 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Search className="w-3.5 h-3.5" /> Browse
              </button>
            )}
          </div>
        </div>

        {/* Direction / Swap control — migration always flows Source → Target */}
        <div className="flex xl:col-span-1 justify-center items-center">
          <button
            onClick={swapSourceTarget}
            title="Swap Source and Target (reverse migration direction)"
            className="group flex flex-col items-center gap-0.5 transition cursor-pointer"
          >
            <span className="text-sm font-bold uppercase tracking-wider text-cyan-500/70 group-hover:text-cyan-400"/>
            <ArrowRight className="w-6 h-6 text-indigo-500/80 group-hover:hidden transition" />
            <ArrowLeftRight className="w-6 h-6 text-cyan-400 hidden group-hover:block" />
            <span className="text-sm font-bold uppercase tracking-wider text-purple-400/70 group-hover:text-cyan-400"/>
          </button>
        </div>

        {/* Target Configuration */}
        <div className="xl:col-span-5 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          {/* Label + Add/Edit Connection + status, all inline */}
          <div className="flex items-center gap-2">
            {connections.length > 0 && (
              <select
                value={selectedTargetConnectionId ?? ''}
                onChange={(e) => e.target.value && applySavedConnection('target', e.target.value)}
                title="Saved connections"
                className="shrink-0 w-40 max-w-[160px] text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500 truncate"
              >
                <option value="">— Saved —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.dialect.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
            )}

            <span className={`flex-1 min-w-0 text-xs font-bold truncate ${
              targetConfig.option.database
                ? 'text-purple-300 font-mono'
                : 'text-purple-200 bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1'
            }`}>
              {targetConfig.option.database
                ? `${targetConfig.option.host ?? 'localhost'} / ${targetConfig.option.database}${targetConfig.schema ? ` / ${targetConfig.schema}` : ''}`
                : 'Configure credentials via Params'}
            </span>

            <button
              data-testid="target-config-btn"
              onClick={() => {
                setActiveModalTarget('target');
                setShowConnectionModal(true);
              }}
              title="Add or edit this connection's credentials"
              className="shrink-0 text-xs font-semibold bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:border-purple-500/40 text-purple-400 rounded transition cursor-pointer flex items-center gap-1.5 px-3 py-1.5"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{targetConfig.option.database ? 'Edit' : 'Add'} Connection</span>
            </button>

            {isTestingTarget ? (
              <span className="text-base text-purple-400 flex items-center gap-1 font-medium shrink-0">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting...
              </span>
            ) : targetConnected ? (
              <button
                data-testid="target-connected-btn"
                onClick={testTargetConnection}
                title="Reconnect and refresh schema list"
                className="group text-base text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-500/20 hover:border-emerald-400/50 hover:bg-emerald-950/70 flex items-center gap-1 font-medium shrink-0 cursor-pointer transition"
              >
                <CheckCircle2 className="w-3.5 h-3.5 group-hover:hidden" />
                <RefreshCw className="w-3.5 h-3.5 hidden group-hover:block" />
                <span className="group-hover:hidden">Connected</span>
                <span className="hidden group-hover:inline">Refresh</span>
              </button>
            ) : (
              <button
                data-testid="target-connect-btn"
                onClick={testTargetConnection}
                title="Retry connection"
                className="text-base text-slate-400 hover:text-purple-300 border border-slate-700 hover:border-purple-500/40 bg-slate-900/60 hover:bg-slate-900 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium shrink-0 cursor-pointer transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry Connection
              </button>
            )}

            {targetConnected && (
              <button
                onClick={() => browseSchema('target')}
                disabled={isBrowsing || selectedObjectTypes.length === 0}
                title="Load this schema's objects to browse and search (no comparison)"
                className="shrink-0 text-base text-purple-300 border border-purple-500/30 hover:border-purple-400/60 bg-purple-950/30 hover:bg-purple-950/60 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Search className="w-3.5 h-3.5" /> Browse
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Target Scope Selection & Trigger Bar */}
      <div className="flex flex-col md:flex-row justify-between md:items-center bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 px-4 gap-3">
        {/* Scope Config Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-semibold text-slate-400 flex items-center gap-1 uppercase tracking-wider border-r border-slate-800 pr-3">
            <Settings className="w-3.5 h-3.5 text-cyan-400" /> Comparison Scope:
          </span>
          <div className="flex items-center gap-2">
            {objectScopeOptions.map((opt) => {
              const active = selectedObjectTypes.includes(opt.type);
              return (
                <button
                  key={opt.type}
                  onClick={() => toggleObjectTypeFilter(opt.type)}
                  className={`px-3 py-1 rounded text-base font-semibold border transition cursor-pointer ${
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

        <div className="flex items-center gap-3">
          {sameConfig && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-amber-400 bg-amber-950/30 border border-amber-500/20 px-3 py-1.5 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" /> Source and target are the same
            </span>
          )}

          <button
            data-testid="compare-btn"
            onClick={runSchemaComparison}
            disabled={isComparing || !sourceConnected || !targetConnected || selectedObjectTypes.length === 0 || sameConfig}
            title={sameConfig ? 'Source and target point to the same database and schema' : undefined}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-base font-bold transition shadow-lg ${
              sourceConnected && targetConnected && selectedObjectTypes.length > 0 && !sameConfig
                ? 'accent-grad on-accent-fg shadow-indigo-500/10 cursor-pointer'
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
      </div>

      <ConnectionModal
        open={showConnectionModal}
        mode="credential"
        dialect={activeModalTarget === 'target' ? targetConfig.dialect : sourceConfig.dialect}
        initialOptions={activeModalTarget === 'target' ? targetConfig.option : sourceConfig.option}
        initialName={
          (activeModalTarget === 'target'
            ? connections.find((c) => c.id === selectedTargetConnectionId)?.name
            : connections.find((c) => c.id === selectedSourceConnectionId)?.name) ?? ''
        }
        onClose={() => {
          setShowConnectionModal(false);
          setActiveModalTarget(null);
        }}
        onSaveCredential={async (input) => {
          // Same credential form as the Credentials manager: save it (encrypted,
          // server-side) then bind it to this side by id.
          const side = activeModalTarget === 'target' ? 'target' : 'source';
          const saved = await addConnection(input);
          applySavedConnection(side, saved.id);
        }}
      />

      <CredentialManager open={showCredentials} onClose={() => setShowCredentials(false)} />

      <MigrationHistory open={showHistory} onClose={() => setShowHistory(false)} />
    </header>
  );
};
