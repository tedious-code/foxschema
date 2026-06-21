import React, { useState, useMemo, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { useSyncStore } from '../store/useSyncStore';
import { Code, Play, RefreshCw, FileText, CheckCircle2, ChevronRight, ChevronDown, AlertCircle, Copy, GitCompareArrows, KeyRound, XCircle, Circle, Download, X, Undo2 } from 'lucide-react';
import { SqlGeneratorModule } from '@foxschema/shared';
import { diffLines } from '../utils/lineDiff';
import { highlightMatch } from '../utils/highlight';
import { formatSql } from '../utils/formatSql';
// Monaco is heavy — load it only when a SQL surface is actually shown
const SqlEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })));
const SqlDiffEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlDiffEditor })));

const EditorFallback: React.FC = () => (
  <div className="flex-1 flex items-center justify-center text-slate-500 text-xs gap-2">
    <RefreshCw className="w-4 h-4 animate-spin" /> Loading editor...
  </div>
);

const ddlGenerator = new SqlGeneratorModule();

// Persisted "skip the deploy confirmation" preference.
const SKIP_DEPLOY_CONFIRM_KEY = 'foxschema-skip-deploy-confirm';

export const RightPanel: React.FC = () => {
  const {
    selectedTable,
    generatedSql,
    applyMigration,
    migrationExecuted,
    isComparing,
    sourceConfig,
    targetConfig,
    syncSelection,
    toggleSyncSelection,
    isMigrating,
    migrationProgress,
    snapshotDdl,
    migrationError,
    migrationRolledBack,
    clearMigrationProgress,
    searchTerm,
    memberSelection,
    toggleMemberSelection,
    setAllMemberSelection,
  } = useSyncStore();

  const includedCount = Object.values(syncSelection).filter(Boolean).length;

  const [activeTab, setActiveTab] = useState<'DIFF' | 'DDL_DIFF' | 'SQL'>('DIFF');
  const [copied, setCopied] = useState(false);
  const [expandedTriggers, setExpandedTriggers] = useState<Record<string, boolean>>({});
  // Matches the case-insensitive schema compare; toggle off to inspect raw identifier casing
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [inlineDiff, setInlineDiff] = useState(false);
  // Schema Blueprint: off = only changed items, on = include unchanged too
  const [showUnchangedDetail, setShowUnchangedDetail] = useState(false);
  // Deploy confirmation dialog
  const [showConfirm, setShowConfirm] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const toggleTriggerDdl = (name: string) =>
    setExpandedTriggers((prev) => ({ ...prev, [name]: !prev[name] }));

  // Pretty-print the migration script — but only when the SQL tab is actually
  // shown, and skip very large scripts: formatting the whole thing (with routine
  // bodies) is synchronous and can freeze the UI on big schemas.
  // NOTE: must stay above any early return — hooks run unconditionally every render.
  const formattedSql = useMemo(() => {
    if (activeTab !== 'SQL' || !generatedSql) return generatedSql ?? '';
    if (generatedSql.length > 50000) return generatedSql;
    return formatSql(generatedSql, targetConfig.dialect);
  }, [activeTab, generatedSql, targetConfig.dialect]);

  if (!selectedTable) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-950/20 p-6">
        <FileText className="w-12 h-12 text-slate-800 mb-3 animate-pulse" />
        <p className="text-sm font-semibold text-slate-400">Select Object to View Details</p>
        <p className="text-xs text-slate-600 max-w-xs text-center mt-1">
          Select an object from the left browser tree to inspect columns, indices, definitions, and generated migration DDL.
        </p>
      </div>
    );
  }

  // Show the confirmation dialog before deploying, unless the user opted out.
  const handleExecuteClick = () => {
    if (localStorage.getItem(SKIP_DEPLOY_CONFIRM_KEY) === 'true') {
      applyMigration();
    } else {
      setDontAskAgain(false);
      setShowConfirm(true);
    }
  };

  const confirmExecute = () => {
    if (dontAskAgain) localStorage.setItem(SKIP_DEPLOY_CONFIRM_KEY, 'true');
    setShowConfirm(false);
    applyMigration();
  };

  const handleCopySql = () => {
    if (!formattedSql) return;
    navigator.clipboard.writeText(formattedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderDdlDiff = () => {
    // Catalog definitions are often a single unreadable line — format non-table
    // DDL on both sides so the diff compares structure, not whitespace
    const isTable = selectedTable.objectType === 'TABLE';
    const rawSource = selectedTable.sourceTable
      ? ddlGenerator.generateObjectDdl(selectedTable.sourceTable)
      : '';
    const rawTarget = selectedTable.targetTable
      ? ddlGenerator.generateObjectDdl(selectedTable.targetTable)
      : '';
    const sourceDdl = isTable ? rawSource : formatSql(rawSource, sourceConfig.dialect);
    const targetDdl = isTable ? rawTarget : formatSql(rawTarget, targetConfig.dialect);

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950/90 border-t border-slate-850">
        {/* Diff header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/60">
          <span className="text-xs font-mono text-slate-400">
            {selectedTable.tableName} — <span className="text-purple-400/80">Original</span> → <span className="text-cyan-400/80">Destination</span>
          </span>
          <div className="flex items-center gap-3">
            <label className="text-[10px] text-slate-400 flex items-center gap-1.5 cursor-pointer" title="Ignore identifier letter-case, matching how columns are compared">
              <input
                type="checkbox"
                checked={ignoreCase}
                onChange={(e) => setIgnoreCase(e.target.checked)}
                className="w-3 h-3 accent-cyan-500 cursor-pointer"
              />
              Ignore case
            </label>
            <button
              onClick={() => setInlineDiff((v) => !v)}
              className="text-[10px] text-slate-300 border border-slate-700 hover:border-slate-500 rounded px-2 py-0.5 transition"
            >
              {inlineDiff ? 'Side-by-side' : 'Inline'}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0">
            <Suspense fallback={<EditorFallback />}>
              <SqlDiffEditor
                original={targetDdl}
                modified={sourceDdl}
                dialect={targetConfig.dialect}
                inline={inlineDiff}
                ignoreCase={ignoreCase}
                highlight={searchTerm}
              />
            </Suspense>
          </div>
        </div>
      </div>
    );
  };

  // Renders one side's column state, highlighting the attributes that differ from the other side
  const renderColumnState = (
    own?: { type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean },
    other?: { type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean }
  ) => {
    if (!own) return <span className="text-slate-600 italic">none</span>;

    const hl = 'text-amber-300 bg-amber-500/15 rounded px-1';
    const typeChanged = !!other && own.type.toLowerCase() !== other.type.toLowerCase();
    const nullChanged = !!other && own.nullable !== other.nullable;
    const defChanged = !!other && (own.defaultValue ?? null) !== (other.defaultValue ?? null);
    const pkChanged = !!other && !!own.primaryKey !== !!other.primaryKey;
    const identityChanged = !!other && !!own.identity !== !!other.identity;
    const hasDefault = own.defaultValue !== undefined && own.defaultValue !== null;

    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={typeChanged ? hl : ''}>{own.type}</span>

        {(!own.nullable || nullChanged) && (
          <span className={nullChanged ? hl : ''}>{own.nullable ? 'NULL' : 'NOT NULL'}</span>
        )}

        {hasDefault ? (
          <span className={defChanged ? hl : ''}>DEFAULT {own.defaultValue}</span>
        ) : defChanged ? (
          <span className={`${hl} italic`}>no default</span>
        ) : null}

        {own.primaryKey ? (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
            pkChanged
              ? 'text-amber-300 bg-amber-500/15 border-amber-500/40'
              : 'text-amber-400 bg-amber-950/40 border-amber-500/20'
          }`}>
            PRIMARY KEY
          </span>
        ) : pkChanged ? (
          <span className={`${hl} italic`}>not PK</span>
        ) : null}

        {own.identity ? (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
            identityChanged
              ? 'text-amber-300 bg-amber-500/15 border-amber-500/40'
              : 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20'
          }`}>
            IDENTITY
          </span>
        ) : identityChanged ? (
          <span className={`${hl} italic`}>not identity</span>
        ) : null}
      </span>
    );
  };

  const renderSchemaObjectDiff = () => {
    // Highlight the object-browser search keyword in the blueprint (e.g. a
    // matched column name), mirroring the SQL panels.
    const query = searchTerm.trim().toLowerCase();

    // Role member deploy selection (changed members only).
    const isRole = selectedTable.objectType === 'ROLE';
    const roleChangedMembers = isRole ? selectedTable.columnDiffs.filter((c) => c.status !== 'UNCHANGED') : [];
    const allMembersSelected =
      roleChangedMembers.length > 0 &&
      roleChangedMembers.every((m) => memberSelection[selectedTable.tableName]?.[m.name] !== false);
    // Hide UNCHANGED items unless the "Show unchanged" toggle is on.
    const keep = (status: string) => showUnchangedDetail || status !== 'UNCHANGED';
    const colDiffs = selectedTable.columnDiffs.filter((c) => keep(c.status));
    const indexDiffs = selectedTable.indexDiffs.filter((i) => keep(i.status));
    const fkDiffs = selectedTable.foreignKeyDiffs.filter((f) => keep(f.status));
    const trgDiffs = (selectedTable.triggerDiffs ?? []).filter((t) => keep(t.status));

    // Counts for the summary — always over the FULL set (independent of the
    // show-unchanged toggle). `original` is the count present in the original
    // (target); ADDED items don't exist there yet.
    const stat = (arr: { status: string }[]) => ({
      original: arr.filter((x) => x.status !== 'ADDED').length,
      added: arr.filter((x) => x.status === 'ADDED').length,
      modified: arr.filter((x) => x.status === 'MODIFIED').length,
      removed: arr.filter((x) => x.status === 'REMOVED').length,
    });
    const summary = [
      { label: 'Columns', s: stat(selectedTable.columnDiffs) },
      { label: 'Indexes', s: stat(selectedTable.indexDiffs) },
      { label: 'Foreign Keys', s: stat(selectedTable.foreignKeyDiffs) },
      { label: 'Triggers', s: stat(selectedTable.triggerDiffs ?? []) },
    ];

    return (
      <div className="flex-1 flex flex-col min-h-0 text-xs overflow-y-auto p-6 space-y-6">
        {/* Table Overview Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/50 tracking-wider">
                {selectedTable.objectType}
              </span>
              <h3 className="text-xl font-extrabold text-slate-50 tracking-tight">{selectedTable.tableName}</h3>
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
              Status:
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                  selectedTable.status === 'ADDED'
                    ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/25'
                    : selectedTable.status === 'REMOVED'
                    ? 'text-rose-400 bg-rose-950/40 border-rose-500/25'
                    : selectedTable.status === 'MODIFIED'
                    ? 'text-amber-400 bg-amber-950/40 border-amber-500/25'
                    : 'text-slate-400 bg-slate-800/60 border-slate-700/40'
                }`}
              >
                {selectedTable.status}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label
              className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded hover:border-cyan-500/40 transition"
              title="Show unchanged columns, indexes, foreign keys and triggers (off = only changes)"
            >
              <input
                type="checkbox"
                checked={showUnchangedDetail}
                onChange={(e) => setShowUnchangedDetail(e.target.checked)}
                className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer"
              />
              Show unchanged
            </label>
            {selectedTable.status !== 'UNCHANGED' && (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded hover:border-cyan-500/40 transition">
                <input
                  type="checkbox"
                  checked={!!syncSelection[selectedTable.tableName]}
                  onChange={() => toggleSyncSelection(selectedTable.tableName)}
                  className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer"
                />
                Deploy to Target
              </label>
            )}
            {(() => {
              const ts = selectedTable.sourceTable?.tablespace ?? selectedTable.targetTable?.tablespace;
              return ts ? (
                <div className="text-[10px] text-slate-400 font-mono bg-slate-900 border border-slate-800 px-3 py-1 rounded" title="Storage tablespace">
                  Tablespace: <span className="text-cyan-300">{ts}</span>
                </div>
              ) : null;
            })()}
            <div className="text-[10px] text-slate-500 font-mono bg-slate-900 border border-slate-800 px-3 py-1 rounded">
              Target Dialect: {targetConfig.dialect.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Change summary — original count + added/modified/removed per category */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summary.map(({ label, s }) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</span>
                <span className="text-xl font-extrabold text-slate-100 leading-none" title={`${s.original} in original`}>
                  {s.original}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold">
                {s.added > 0 && <span className="text-emerald-400">+{s.added} added</span>}
                {s.modified > 0 && <span className="text-amber-400">~{s.modified} modified</span>}
                {s.removed > 0 && <span className="text-rose-400">-{s.removed} removed</span>}
                {s.added === 0 && s.modified === 0 && s.removed === 0 && <span className="text-slate-600">no changes</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Routine Parameters (functions & procedures) */}
        {(selectedTable.objectType === 'FUNCTION' || selectedTable.objectType === 'PROCEDURE') && (() => {
          const routine = selectedTable.sourceTable ?? selectedTable.targetTable;
          const params = routine?.parameters ?? [];
          const modeCls = (m: string) =>
            m === 'RETURN' || m === 'RESULT'
              ? 'text-emerald-300 bg-emerald-950/40 border-emerald-500/25'
              : m === 'OUT' || m === 'INOUT'
              ? 'text-amber-300 bg-amber-950/40 border-amber-500/25'
              : 'text-slate-300 bg-slate-800 border-slate-700/50';
          return (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span>
                Parameters
                {selectedTable.objectType === 'FUNCTION' && routine?.functionKind && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-indigo-300 bg-indigo-950/40 border-indigo-500/30 uppercase tracking-wider">
                    {routine.functionKind}-valued
                  </span>
                )}
              </h4>
              {params.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No parameters.</p>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                        <th className="p-3 font-semibold">Parameter</th>
                        <th className="p-3 font-semibold">Type</th>
                        <th className="p-3 font-semibold text-right">Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {params.map((p, i) => (
                        <tr key={`${p.name}-${i}`} className="hover:bg-slate-900/30">
                          <td className="p-3 font-mono text-slate-200">
                            {p.name || <span className="text-slate-600 italic">(unnamed)</span>}
                          </td>
                          <td className="p-3 font-mono text-cyan-300/90">{p.type}</td>
                          <td className="p-3 text-right">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${modeCls(p.mode)}`}>{p.mode}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {/* Sequence / Type Attribute Section */}
        {(selectedTable.objectType === 'SEQUENCE' || selectedTable.objectType === 'TYPE') && (() => {
          const isSeq = selectedTable.objectType === 'SEQUENCE';
          const src: any = isSeq ? selectedTable.sourceTable?.sequence : selectedTable.sourceTable?.userType;
          const tgt: any = isSeq ? selectedTable.targetTable?.sequence : selectedTable.targetTable?.userType;
          const rows: { label: string; key: string }[] = isSeq
            ? [
                { label: 'Data Type', key: 'dataType' },
                { label: 'Start', key: 'start' },
                { label: 'Increment', key: 'increment' },
                { label: 'Min Value', key: 'minValue' },
                { label: 'Max Value', key: 'maxValue' },
                { label: 'Cycle', key: 'cycle' },
                { label: 'Cache', key: 'cache' },
              ]
            : [
                { label: 'Source Type', key: 'sourceType' },
                { label: 'Meta Type', key: 'metaType' },
              ];
          const fmt = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v));

          return (
            <div>
              <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isSeq ? 'bg-teal-400' : 'bg-sky-400'}`}></span>
                {isSeq ? 'Sequence Attributes' : 'Type Definition'}
              </h4>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800 text-slate-300">
                      <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Attribute</th>
                      <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Source</th>
                      <th className="p-3 text-[11px] font-bold uppercase tracking-wider text-center">Compare</th>
                      <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {rows.map((r) => {
                      const sv = fmt(src?.[r.key]);
                      const tv = fmt(tgt?.[r.key]);
                      const changed = sv !== tv;
                      return (
                        <tr key={r.key} className={changed ? 'bg-amber-950/10' : 'hover:bg-slate-900/20'}>
                          <td className="p-3 text-slate-100 font-bold">{r.label}</td>
                          <td className={`p-3 font-mono font-semibold ${changed ? 'text-amber-300' : 'text-slate-200'}`}>{sv}</td>
                          <td className="p-3 text-center text-slate-600"><ChevronRight className="w-4 h-4 mx-auto" /></td>
                          <td className={`p-3 font-mono font-semibold ${changed ? 'text-amber-300' : 'text-slate-200'}`}>{tv}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Structured type member attributes */}
              {!isSeq && ((src?.attributes?.length ?? 0) > 0 || (tgt?.attributes?.length ?? 0) > 0) && (() => {
                const sAttrs: { name: string; type: string }[] = src?.attributes ?? [];
                const tAttrs: { name: string; type: string }[] = tgt?.attributes ?? [];
                const tMap = new Map(tAttrs.map((a) => [a.name.toUpperCase(), a]));
                const sMap = new Map(sAttrs.map((a) => [a.name.toUpperCase(), a]));
                const names = Array.from(new Set([...sAttrs.map((a) => a.name), ...tAttrs.map((a) => a.name)]));
                return (
                  <div className="mt-3">
                    <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">Attributes</h5>
                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-900 border-b border-slate-800 text-slate-300">
                            <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Attribute</th>
                            <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Source Type</th>
                            <th className="p-3 text-[11px] font-bold uppercase tracking-wider text-center">Compare</th>
                            <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Target Type</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850">
                          {names.map((n) => {
                            const sa = sMap.get(n.toUpperCase());
                            const ta = tMap.get(n.toUpperCase());
                            const changed = (sa?.type ?? '') !== (ta?.type ?? '');
                            return (
                              <tr key={n} className={changed ? 'bg-amber-950/10' : 'hover:bg-slate-900/20'}>
                                <td className="p-3 text-slate-100 font-bold font-mono">{n}</td>
                                <td className={`p-3 font-mono font-semibold ${changed ? 'text-amber-300' : 'text-slate-200'}`}>{sa?.type ?? <span className="text-slate-600 italic font-normal">none</span>}</td>
                                <td className="p-3 text-center text-slate-600"><ChevronRight className="w-4 h-4 mx-auto" /></td>
                                <td className={`p-3 font-mono font-semibold ${changed ? 'text-amber-300' : 'text-slate-200'}`}>{ta?.type ?? <span className="text-slate-600 italic font-normal">none</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Columns Diff Section (Only show if columns present, e.g., Tables or Views) */}
        {colDiffs.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span> {isRole ? 'Members' : 'Column Blueprint / Attributes'}
              {isRole && roleChangedMembers.length > 0 && (
                <label
                  className="ml-auto flex items-center gap-1.5 normal-case text-[10px] font-semibold text-slate-300 cursor-pointer"
                  title="Include/exclude all changed members in the deploy script"
                >
                  <input
                    type="checkbox"
                    checked={allMembersSelected}
                    onChange={(e) => setAllMemberSelection(selectedTable.tableName, e.target.checked)}
                    className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer"
                  />
                  Deploy all members
                </label>
              )}
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">{selectedTable.objectType === 'ROLE' ? 'Member' : 'Column Name'}</th>
                    <th className="p-3 font-semibold">Source State</th>
                    <th className="p-3 font-semibold text-center">Compare</th>
                    <th className="p-3 font-semibold">Target State</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {colDiffs.map((col) => {
                    let opBadge = (
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        No Change
                      </span>
                    );
                    let rowBg = 'hover:bg-slate-900/20';

                    if (col.status === 'ADDED') {
                      opBadge = (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">
                          ADD COLUMN
                        </span>
                      );
                      rowBg = 'bg-emerald-950/10 hover:bg-emerald-950/20';
                    } else if (col.status === 'REMOVED') {
                      opBadge = (
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">
                          DROP COLUMN
                        </span>
                      );
                      rowBg = 'bg-rose-950/10 hover:bg-rose-950/20';
                    } else if (col.status === 'MODIFIED') {
                      opBadge = (
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/20">
                          ALTER TYPE
                        </span>
                      );
                      rowBg = 'bg-amber-950/10 hover:bg-amber-950/20';
                    }

                    const isPk = col.source?.primaryKey || col.target?.primaryKey;

                    return (
                      <tr key={col.name} className={`${rowBg} transition-colors`}>
                        <td className="p-3 font-semibold text-slate-200 font-mono">
                          <span className="flex items-center gap-1.5">
                            {selectedTable.objectType === 'ROLE' && col.status !== 'UNCHANGED' && (
                              <input
                                type="checkbox"
                                checked={memberSelection[selectedTable.tableName]?.[col.name] !== false}
                                onChange={() => toggleMemberSelection(selectedTable.tableName, col.name)}
                                title="Include this member in the deploy script"
                                className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer shrink-0"
                              />
                            )}
                            {highlightMatch(col.name, query)}
                            {isPk && <KeyRound className="w-3.5 h-3.5 text-amber-400" aria-label="Primary key" />}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 font-mono">
                          {renderColumnState(col.source, col.target)}
                        </td>
                        <td className="p-3 text-center text-slate-600">
                          <ChevronRight className="w-4 h-4 mx-auto text-slate-600" />
                        </td>
                        <td className="p-3 text-slate-400 font-mono">
                          {renderColumnState(col.target, col.source)}
                        </td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Primary Key Diff Section */}
        {selectedTable.objectType === 'TABLE' && (() => {
          const srcPk = selectedTable.sourceTable?.primaryKey;
          const tgtPk = selectedTable.targetTable?.primaryKey;
          const pkChanged = JSON.stringify(srcPk?.columns ?? []) !== JSON.stringify(tgtPk?.columns ?? []);

          let opBadge = <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">No Change</span>;
          let rowBg = 'hover:bg-slate-900/10';
          if (srcPk && !tgtPk) {
            opBadge = <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">ADD PRIMARY KEY</span>;
            rowBg = 'bg-emerald-950/10';
          } else if (!srcPk && tgtPk) {
            opBadge = <span className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">DROP PRIMARY KEY</span>;
            rowBg = 'bg-rose-950/10';
          } else if (srcPk && tgtPk && pkChanged) {
            opBadge = <span className="text-[10px] text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/20">RECREATE</span>;
            rowBg = 'bg-amber-950/10';
          }

          return (
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span> Primary Key
              </h4>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                      <th className="p-3 font-semibold">Constraint Name</th>
                      <th className="p-3 font-semibold">Source Columns</th>
                      <th className="p-3 font-semibold text-center">Compare</th>
                      <th className="p-3 font-semibold">Target Columns</th>
                      <th className="p-3 font-semibold text-right">Operation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!srcPk && !tgtPk ? (
                      <tr>
                        <td colSpan={5} className="p-3 text-slate-600 italic text-center">
                          No primary key defined on this table
                        </td>
                      </tr>
                    ) : (
                      <tr className={`${rowBg} transition-colors`}>
                        <td className="p-3 text-slate-200 font-semibold font-mono">
                          <span className="flex items-center gap-1.5">
                            <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                            {srcPk?.name ?? tgtPk?.name ?? '—'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 font-mono">
                          {srcPk ? srcPk.columns.join(', ') : <span className="text-slate-600 italic">none</span>}
                        </td>
                        <td className="p-3 text-center text-slate-600">
                          <ChevronRight className="w-4 h-4 mx-auto text-slate-600" />
                        </td>
                        <td className="p-3 text-slate-400 font-mono">
                          {tgtPk ? tgtPk.columns.join(', ') : <span className="text-slate-600 italic">none</span>}
                        </td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* View / Function / Procedure Definition — below the column blueprint */}
        {selectedTable.objectType !== 'TABLE' && (selectedTable.sourceTable?.definition || selectedTable.targetTable?.definition) && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> Source DDL Definition
            </h4>
            <div className="bg-slate-950 border border-slate-850 rounded-lg overflow-hidden h-64">
              <Suspense fallback={<EditorFallback />}>
                <SqlEditor
                  highlight={searchTerm}
                  dialect={selectedTable.sourceTable?.definition ? sourceConfig.dialect : targetConfig.dialect}
                  value={
                    selectedTable.sourceTable?.definition
                      ? formatSql(selectedTable.sourceTable.definition, sourceConfig.dialect)
                      : formatSql(selectedTable.targetTable?.definition ?? '', targetConfig.dialect)
                  }
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* Indices Diff Section */}
        {indexDiffs.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> Table Indexes
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">Index Name</th>
                    <th className="p-3 font-semibold">Columns</th>
                    <th className="p-3 font-semibold">Constraint</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {indexDiffs.map((idx) => {
                    const info = idx.source || idx.target;
                    let opBadge = <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">No Change</span>;
                    if (idx.status === 'ADDED') {
                      opBadge = <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">CREATE INDEX</span>;
                    } else if (idx.status === 'REMOVED') {
                      opBadge = <span className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">DROP INDEX</span>;
                    }

                    return (
                      <tr key={idx.name} className="hover:bg-slate-900/10">
                        <td className="p-3 text-slate-200 font-semibold font-mono">{highlightMatch(idx.name, query)}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.columns.join(', ')}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.unique ? 'UNIQUE' : 'NON-UNIQUE'}</td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Foreign Keys Diff Section */}
        {fkDiffs.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-purple-500 rounded-full"></span> Foreign Key Relations
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">Constraint Name</th>
                    <th className="p-3 font-semibold">Columns</th>
                    <th className="p-3 font-semibold">References Table</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {fkDiffs.map((fk) => {
                    const info = fk.source || fk.target;
                    let opBadge = <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">No Change</span>;
                    if (fk.status === 'ADDED') {
                      opBadge = <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">ADD CONSTRAINT</span>;
                    } else if (fk.status === 'REMOVED') {
                      opBadge = <span className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">DROP CONSTRAINT</span>;
                    }

                    return (
                      <tr key={fk.name} className="hover:bg-slate-900/10">
                        <td className="p-3 text-slate-200 font-semibold font-mono">{highlightMatch(fk.name, query)}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.columns.join(', ')}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.referencedTable} ({info?.referencedColumns.join(', ')})</td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Triggers Diff Section — always visible for tables */}
        {selectedTable.objectType === 'TABLE' && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full"></span> Table Triggers
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">Trigger Name</th>
                    <th className="p-3 font-semibold">Source State</th>
                    <th className="p-3 font-semibold text-center">Compare</th>
                    <th className="p-3 font-semibold">Target State</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {trgDiffs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-3 text-slate-600 italic text-center">
                        No triggers defined on this table
                      </td>
                    </tr>
                  ) : (
                    trgDiffs.map((trg) => {
                      let opBadge = <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">No Change</span>;
                      let rowBg = 'hover:bg-slate-900/10';
                      if (trg.status === 'ADDED') {
                        opBadge = <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">CREATE TRIGGER</span>;
                        rowBg = 'bg-emerald-950/10 hover:bg-emerald-950/20';
                      } else if (trg.status === 'REMOVED') {
                        opBadge = <span className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">DROP TRIGGER</span>;
                        rowBg = 'bg-rose-950/10 hover:bg-rose-950/20';
                      } else if (trg.status === 'MODIFIED') {
                        opBadge = <span className="text-[10px] text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/20">RECREATE</span>;
                        rowBg = 'bg-amber-950/10 hover:bg-amber-950/20';
                      }

                      const stateLabel = (info?: { timing?: string; event?: string }) =>
                        info ? `${info.timing ?? ''} ${info.event ?? ''}`.trim() || 'present' : null;

                      const isExpanded = !!expandedTriggers[trg.name];
                      const oldDdl = trg.target?.definition ? formatSql(trg.target.definition, targetConfig.dialect).trim() : '';
                      const newDdl = trg.source?.definition ? formatSql(trg.source.definition, sourceConfig.dialect).trim() : '';
                      // A one-sided trigger diffs against '' — drop the resulting blank line
                      const ddlLines = isExpanded
                        ? diffLines(oldDdl, newDdl, { ignoreCase }).filter((l) => !(l.text === '' && (oldDdl === '' || newDdl === '')))
                        : [];

                      return (
                        <React.Fragment key={trg.name}>
                          <tr
                            onClick={() => toggleTriggerDdl(trg.name)}
                            title="Click to show DDL diff"
                            className={`${rowBg} transition-colors cursor-pointer`}
                          >
                            <td className="p-3 text-slate-200 font-semibold font-mono">
                              <span className="flex items-center gap-1.5">
                                {isExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                  : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                                {highlightMatch(trg.name, query)}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400 font-mono">
                              {stateLabel(trg.source) ?? <span className="text-slate-600 italic">none</span>}
                            </td>
                            <td className="p-3 text-center text-slate-600">
                              <ChevronRight className="w-4 h-4 mx-auto text-slate-600" />
                            </td>
                            <td className="p-3 text-slate-400 font-mono">
                              {stateLabel(trg.target) ?? <span className="text-slate-600 italic">none</span>}
                            </td>
                            <td className="p-3 text-right">{opBadge}</td>
                          </tr>

                          {/* Expanded DDL diff for this trigger */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={5} className="p-0 bg-slate-950/90 border-t border-slate-800/60">
                                {trg.source?.definition || trg.target?.definition ? (
                                  <div className="max-h-72 overflow-auto">
                                    <table className="w-full font-mono text-[11px] border-collapse">
                                      <tbody>
                                        {ddlLines.map((line, i) => {
                                          const textClass =
                                            line.type === 'added'
                                              ? 'text-emerald-300'
                                              : line.type === 'removed'
                                              ? 'text-rose-300'
                                              : 'text-slate-300';
                                          const lineBg =
                                            line.type === 'added'
                                              ? 'bg-emerald-500/10'
                                              : line.type === 'removed'
                                              ? 'bg-rose-500/10'
                                              : '';
                                          const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                                          return (
                                            <tr key={i} className={lineBg}>
                                              <td className={`w-5 text-center select-none ${textClass} align-top`}>{marker}</td>
                                              <td className={`px-2 py-0.5 whitespace-pre ${textClass}`}>{line.text}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="p-3 text-slate-600 italic text-center">
                                    No DDL definition available for this trigger
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-900 h-full">
      {/* Detail Panel Toolbar */}
      <div className="flex justify-between items-center px-6 py-3 border-b border-slate-800 bg-slate-950/40">
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveTab('DIFF')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === 'DIFF'
                ? 'bg-slate-850 text-slate-100 border border-slate-700/80 shadow'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Schema Blueprint
          </button>
          <button
            onClick={() => setActiveTab('DDL_DIFF')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === 'DDL_DIFF'
                ? 'bg-slate-850 text-slate-100 border border-slate-700/80 shadow'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <GitCompareArrows className="w-3.5 h-3.5" /> DDL Diff
          </button>
          <button
            onClick={() => setActiveTab('SQL')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === 'SQL'
                ? 'bg-slate-850 text-slate-100 border border-slate-700/80 shadow'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Code className="w-3.5 h-3.5" /> Migration SQL
          </button>
        </div>

        {/* Action Panel Actions */}
        <div className="flex items-center gap-2">
          {activeTab === 'SQL' && generatedSql && (
            <button
              onClick={handleCopySql}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-350 hover:text-slate-150 border border-slate-800 rounded bg-slate-950/40 hover:bg-slate-900 transition"
            >
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Copy SQL'}
            </button>
          )}

          <button
            onClick={handleExecuteClick}
            disabled={isComparing || isMigrating || migrationExecuted || includedCount === 0}
            title={includedCount === 0 ? 'No objects selected for deployment' : `Deploy ${includedCount} object(s) to target`}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold transition shadow ${
              migrationExecuted
                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/25 cursor-default'
                : includedCount === 0
                ? 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 on-accent-fg cursor-pointer shadow-emerald-500/5'
            }`}
          >
            {isMigrating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Migrating...
              </>
            ) : migrationExecuted ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> Migration Implemented
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Execute Sync Script ({includedCount})
              </>
            )}
          </button>

          {showConfirm && createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setShowConfirm(false)}
            >
              <div
                className="w-full max-w-[440px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                  <h2 className="text-slate-100 font-bold text-base">Execute sync script?</h2>
                </div>
                <div className="p-6 space-y-3">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    This runs the generated migration against the{' '}
                    <span className="font-bold text-purple-300">target</span> database
                    {' '}(<span className="font-mono text-xs">{targetConfig.dialect.toUpperCase()}</span>), applying{' '}
                    <span className="font-bold text-slate-100">{includedCount}</span> object change{includedCount === 1 ? '' : 's'}.
                    This cannot be undone automatically.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dontAskAgain}
                      onChange={(e) => setDontAskAgain(e.target.checked)}
                      className="w-4 h-4 accent-cyan-500 cursor-pointer"
                    />
                    Don't show this again
                  </label>
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 bg-slate-950/60 border-t border-slate-800">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-850/50 rounded transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmExecute}
                    className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 on-accent-fg rounded transition shadow flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Execute
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* Main Panel Content Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'DIFF' ? (
          renderSchemaObjectDiff()
        ) : activeTab === 'DDL_DIFF' ? (
          renderDdlDiff()
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-950/90 border-t border-slate-850">
            <div className="flex-1 min-h-0 relative">
              <div className="absolute inset-0">
                <Suspense fallback={<EditorFallback />}>
                  <SqlEditor
                    dialect={targetConfig.dialect}
                    value={formattedSql || '-- No migration script generated.'}
                    highlight={searchTerm}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Migration Progress Panel */}
      {migrationProgress.length > 0 && (
        <div className="fixed bottom-6 right-6 w-[380px] max-h-[60vh] flex flex-col bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl backdrop-blur-md z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/60">
            <h4 className="text-xs font-bold text-slate-100 flex items-center gap-2">
              {isMigrating ? (
                <><RefreshCw className="w-4 h-4 animate-spin text-cyan-400" /> Migrating Target...</>
              ) : migrationError ? (
                <><XCircle className="w-4 h-4 text-rose-400" /> Migration Failed</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Migration Complete</>
              )}
            </h4>
            <div className="flex items-center gap-1.5">
              {snapshotDdl && (
                <button
                  onClick={() => {
                    const blob = new Blob([snapshotDdl], { type: 'text/sql' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `target-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  title="Download pre-migration schema snapshot"
                  className="flex items-center gap-1 text-[10px] text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-2 py-1 hover:bg-slate-800 transition"
                >
                  <Download className="w-3 h-3" /> Snapshot
                </button>
              )}
              {!isMigrating && (
                <button
                  onClick={clearMigrationProgress}
                  className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {migrationProgress.map((item) => (
              <div
                key={`${item.action}-${item.objectName}`}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-xs ${
                  item.status === 'FAILED' ? 'bg-rose-950/30 border border-rose-500/20' : 'bg-slate-950/40'
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {item.status === 'PENDING' && <Circle className="w-3.5 h-3.5 text-slate-600" />}
                  {item.status === 'RUNNING' && <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                  {item.status === 'SUCCESS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {item.status === 'FAILED' && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                </span>
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-slate-200">
                    <span className="text-slate-500 font-sans font-bold text-[10px] mr-1.5">{item.action}</span>
                    {item.objectName}
                  </span>
                  <span className="text-slate-600 ml-1.5 text-[10px] uppercase">{item.objectType}</span>
                  {item.error && (
                    <p className="text-[10px] text-rose-400 mt-1 font-mono break-all">{item.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!isMigrating && migrationError && (
            <div className="px-4 py-3 border-t border-slate-800 bg-rose-950/30 flex items-start gap-2">
              <Undo2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-300">
                {migrationRolledBack
                  ? 'All changes were rolled back — the target is unchanged.'
                  : 'Rollback could not be confirmed — verify the target manually (snapshot available above).'}
              </p>
            </div>
          )}
          {!isMigrating && !migrationError && (
            <div className="px-4 py-3 border-t border-slate-800 bg-emerald-950/20">
              <p className="text-[11px] text-slate-300">
                All {migrationProgress.length} object(s) deployed and committed to the target.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
