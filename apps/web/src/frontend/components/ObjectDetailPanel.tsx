import React, { useState, useMemo, Suspense, lazy } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Code, Play, RefreshCw, FileText, CheckCircle2, ChevronRight, ChevronDown, KeyRound, Copy, GitCompareArrows, AlertTriangle } from 'lucide-react';
import { SqlGeneratorModule } from '../lib/sql-generator';
import { findDropDependencies } from '../lib/dependency-scan';
import { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, resolveDialect } from '../lib/migration-validation';
import { buildIncludedDiffs, buildMapping } from '../store/sync-helpers';
import { diffLines } from '../utils/lineDiff';
import { highlightMatch } from '../utils/highlight';
import { formatSql } from '../utils/formatSql';
import type { TableDiff } from '../lib/types';
import { MigrationProgressPanel } from './object-detail/MigrationProgressPanel';
import { DeployConfirmDialog } from './object-detail/DeployConfirmDialog';
import { DependencyWarningDialog } from './object-detail/DependencyWarningDialog';
import { ValidationWarningsDialog } from './object-detail/ValidationWarningsDialog';
import { CrossDialectReadinessDialog } from './object-detail/CrossDialectReadinessDialog';
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

// ── Status-driven DDL diff for tables ────────────────────────────────────────
// A raw text diff of two rendered CREATE TABLEs mis-reads a column *reorder* as a
// change, and colours a source-only column as a deletion — when it's really an ADD
// the migration will apply to the target. So for tables we drive the colouring from
// the already-correct columnDiffs instead: render the source (the desired end state)
// column-by-column, tag each line by its ColumnDiff status, then append the
// target-only (REMOVED) columns. Same source of truth the column table uses.
type DdlLineKind = 'added' | 'removed' | 'modified' | 'neutral';
interface DdlDiffLine { kind: DdlLineKind; marker: string; text: string; }

const kindForStatus = (status?: string): DdlLineKind =>
  status === 'ADDED' ? 'added'
    : status === 'REMOVED' ? 'removed'
    : status === 'MODIFIED' ? 'modified'
    : 'neutral';

const markerForKind = (kind: DdlLineKind): string =>
  kind === 'added' ? '+' : kind === 'removed' ? '-' : kind === 'modified' ? '~' : ' ';

// Colour trailing CREATE INDEX / ADD CONSTRAINT lines by their own diff status.
const trailingLineKind = (text: string, diff: TableDiff, baseIsSource: boolean): DdlLineKind => {
  const idx = text.match(/^\s*CREATE(?:\s+UNIQUE)?\s+INDEX\s+(\S+)\s+ON\b/i);
  if (idx) {
    const st = (diff.indexDiffs ?? []).find((d) => d.name.toUpperCase() === idx[1].toUpperCase())?.status;
    return baseIsSource ? kindForStatus(st) : 'removed';
  }
  const fk = text.match(/ADD\s+CONSTRAINT\s+(\S+)\s+FOREIGN\s+KEY\b/i);
  if (fk) {
    const st = (diff.foreignKeyDiffs ?? []).find((d) => d.name.toUpperCase() === fk[1].toUpperCase())?.status;
    return baseIsSource ? kindForStatus(st) : 'removed';
  }
  return 'neutral';
};

function buildTableDdlDiffLines(
  diff: TableDiff,
  sourceDialect: string,
  targetDialect: string,
  strip: (ddl: string) => string,
): DdlDiffLine[] {
  const src = diff.sourceTable;
  const tgt = diff.targetTable;
  const base = src ?? tgt;
  if (!base) return [];
  const baseIsSource = !!src;

  const colStatus = new Map<string, string>();
  for (const c of diff.columnDiffs ?? []) colStatus.set(c.name.toUpperCase(), c.status);

  const baseDialect = baseIsSource ? sourceDialect : targetDialect;
  // Render the table WITHOUT triggers — generateObjectDdl only appends the raw trigger
  // body (Oracle stores no CREATE TRIGGER header) and can't colour it, so we render
  // triggers ourselves below with a name header + status colour.
  const baseLines = strip(ddlGenerator.generateObjectDdl({ ...base, triggers: [] }, baseDialect)).split('\n');
  const out: DdlDiffLine[] = [];

  // renderCreateTable emits: header, one line per base.columns (in order), an optional
  // PK line, then ");" — so column N is baseLines[1 + N].
  out.push({ kind: 'neutral', marker: ' ', text: baseLines[0] ?? `CREATE TABLE ${base.name} (` });
  let li = 1;
  for (let c = 0; c < base.columns.length; c++, li++) {
    const kind = baseIsSource ? kindForStatus(colStatus.get(base.columns[c].name.toUpperCase())) : 'removed';
    out.push({ kind, marker: markerForKind(kind), text: baseLines[li] ?? '' });
  }

  // Target-only columns the migration will DROP — pull their rendered line from the
  // target side and slot them in after the desired column set.
  if (src && tgt) {
    const tgtLines = strip(ddlGenerator.generateObjectDdl({ ...tgt, triggers: [] }, targetDialect)).split('\n');
    tgt.columns.forEach((col, t) => {
      if (colStatus.get(col.name.toUpperCase()) === 'REMOVED') {
        out.push({ kind: 'removed', marker: '-', text: tgtLines[1 + t] ?? `  ${col.name}` });
      }
    });
  }

  // PK line, ");", and any CREATE INDEX / ADD CONSTRAINT lines appended after.
  for (; li < baseLines.length; li++) {
    const text = baseLines[li];
    if (text === undefined) continue;
    const kind = trailingLineKind(text, diff, baseIsSource);
    out.push({ kind, marker: markerForKind(kind), text });
  }

  // Triggers — rendered from triggerDiffs so we surface the name (Oracle keeps only the
  // raw body) and colour by status. Desired end-state triggers (source) first, then
  // target-only (REMOVED) ones.
  const pushTrigger = (
    name: string,
    trg: { timing?: string; event?: string; definition?: string },
    kind: DdlLineKind,
  ) => {
    const marker = markerForKind(kind);
    const meta = [trg.timing, trg.event].filter(Boolean).join(' ');
    out.push({ kind, marker, text: `-- TRIGGER ${name}${meta ? ` (${meta})` : ''}` });
    const body = (trg.definition ?? '').trim();
    if (body) for (const bl of body.split('\n')) out.push({ kind, marker, text: bl });
    else out.push({ kind, marker, text: '  -- no definition available' });
  };
  const trigDiffs = diff.triggerDiffs ?? [];
  for (const td of trigDiffs) {
    if (td.status === 'REMOVED') continue;
    const trg = td.source ?? td.target;
    if (trg) pushTrigger(td.name, trg, baseIsSource ? kindForStatus(td.status) : 'removed');
  }
  for (const td of trigDiffs) {
    if (td.status === 'REMOVED' && td.target) pushTrigger(td.name, td.target, 'removed');
  }

  // Trim trailing blank lines left by the DDL generator.
  while (out.length && out[out.length - 1].text.trim() === '') out.pop();

  return out;
}

export const ObjectDetailPanel: React.FC = () => {
  const {
    selectedTable,
    generatedSql,
    applyMigration,
    migrationExecuted,
    isComparing,
    sourceConfig,
    targetConfig,
    targetConnected,
    compareResult,
    browseMode,
    syncSelection,
    toggleSyncSelection,
    nonDestructive,
    isMigrating,
    searchTerm,
    memberSelection,
    toggleMemberSelection,
    setAllMemberSelection,
    targetServerVersion,
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
  // Pre-deploy warning: dropped tables/columns still referenced by views/functions/procedures.
  // The dialog always renders the live scan (below) — this only tracks open/closed.
  const [showDepsDialog, setShowDepsDialog] = useState(false);
  // Explicit acknowledgment for destructive drops / MySQL binlog risk — keyed to the
  // exact generatedSql that was acknowledged, so any change to the plan (new selection,
  // toggling non-destructive, etc.) silently invalidates a stale checkbox instead of
  // carrying forward consent for a plan the user never actually saw.
  const [destructiveAckSql, setDestructiveAckSql] = useState<string | null>(null);
  const [mysqlAckSql, setMysqlAckSql] = useState<string | null>(null);
  const [narrowingAckSql, setNarrowingAckSql] = useState<string | null>(null);
  const [showFkDialog, setShowFkDialog] = useState(false);
  const [showNarrowingDialog, setShowNarrowingDialog] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showReadinessDialog, setShowReadinessDialog] = useState(false);

  // Live dependency scan — recomputed on every selection/nonDestructive change, not just
  // on Execute click, so the button can stay disabled until conflicts are resolved.
  const liveDropDeps = useMemo(
    () => (compareResult ? findDropDependencies(compareResult.tables, syncSelection, { nonDestructive }) : []),
    [compareResult, syncSelection, nonDestructive]
  );
  const hasUnresolvedDropDeps = liveDropDeps.length > 0;

  // Live pre-flight validation — missing FK targets, narrowing type changes, and the
  // generator's own "-- review:" / "MANUAL REVIEW REQUIRED" notices surfaced up front
  // instead of only inside the scrolled SQL preview.
  const missingFkIssues = useMemo(
    () => (compareResult ? findMissingFkTargets(compareResult.tables, syncSelection) : []),
    [compareResult, syncSelection]
  );
  const narrowingIssues = useMemo(
    () => (compareResult ? findNarrowingTypeChanges(compareResult.tables, syncSelection, resolveDialect(targetConfig.dialect)) : []),
    [compareResult, syncSelection, targetConfig.dialect]
  );
  const reviewIssues = useMemo(() => {
    if (!compareResult) return [];
    const includedDiffs = buildIncludedDiffs(compareResult.tables, syncSelection, memberSelection);
    const steps = ddlGenerator.generateMigrationPlan(
      includedDiffs,
      targetConfig.dialect,
      buildMapping({ sourceConfig, targetConfig, nonDestructive, targetServerVersion })
    );
    return extractReviewNotices(steps);
  }, [compareResult, syncSelection, memberSelection, sourceConfig, targetConfig, nonDestructive, targetServerVersion]);
  const hasMissingFkTargets = missingFkIssues.length > 0;
  const hasNarrowingChanges = narrowingIssues.length > 0;
  const narrowingAcked = narrowingAckSql !== null && narrowingAckSql === generatedSql;

  // Destructive drops (DROP TABLE/COLUMN/INDEX) in the generated plan while non-destructive
  // mode is off — require an explicit checkbox acknowledgment before Execute unlocks.
  const hasDestructiveDrops = !nonDestructive && !!generatedSql && /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i.test(generatedSql);
  const destructiveDropsAcked = destructiveAckSql !== null && destructiveAckSql === generatedSql;

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

  // Proceed to the normal confirm step (or deploy directly if the user opted out).
  const proceedToConfirm = () => {
    if (localStorage.getItem(SKIP_DEPLOY_CONFIRM_KEY) === 'true') {
      applyMigration();
    } else {
      setDontAskAgain(false);
      setShowConfirm(true);
    }
  };

  // Execute is disabled whenever hasUnresolvedDropDeps is true (see the disabled
  // expression on the button below), so reaching this handler means the dependency
  // scan is already clean. Kept as a defensive re-check rather than trusting that
  // every call site respects the disabled state.
  const handleExecuteClick = () => {
    if (liveDropDeps.length > 0) {
      setShowDepsDialog(true);
      return;
    }
    proceedToConfirm();
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
    // DDL on both sides so the diff compares structure, not whitespace.
    // Strip schema qualifiers from both sides before diffing: Postgres stores
    // view/function bodies with schema-prefixed table names (APP.ORDERS) while
    // the source may not, producing false-positive diff lines that aren't real
    // structural changes. Schema names belong in the Migration SQL tab, not here.
    const stripSchemas = (ddl: string) => {
      const schemas = [sourceConfig.schema, targetConfig.schema].filter(Boolean);
      let out = ddl;
      for (const s of schemas) {
        // Match schema. or "schema". — word-boundary before, dot after
        out = out.replace(new RegExp(`\\b${s}\\.`, 'gi'), '');
        out = out.replace(new RegExp(`"${s}"\\s*\\.\\s*`, 'gi'), '');
      }
      return out;
    };

    const isTable = selectedTable.objectType === 'TABLE';

    // Tables: status-driven colouring from columnDiffs (aligns by column name, colours
    // by what the migration DOES — see buildTableDdlDiffLines). Everything else
    // (views/functions/triggers/sequences) keeps the Monaco text diff.
    const tableLines = isTable
      ? buildTableDdlDiffLines(selectedTable, sourceConfig.dialect, targetConfig.dialect, stripSchemas)
      : [];
    const q = searchTerm.trim().toLowerCase();

    const rawSource = !isTable && selectedTable.sourceTable
      ? ddlGenerator.generateObjectDdl(selectedTable.sourceTable, sourceConfig.dialect)
      : '';
    const rawTarget = !isTable && selectedTable.targetTable
      ? ddlGenerator.generateObjectDdl(selectedTable.targetTable, targetConfig.dialect)
      : '';
    const sourceDdl = stripSchemas(formatSql(rawSource, sourceConfig.dialect));
    const targetDdl = stripSchemas(formatSql(rawTarget, targetConfig.dialect));

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950/90 border-t border-slate-850">
        {/* Diff header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/60">
          <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
            <span className="text-slate-300">{selectedTable.tableName}</span>
            <span className="text-slate-600">—</span>
            {isTable ? (
              /* Tables show a single canonical view (source column order = the desired
                 end state) with each line coloured by its ColumnDiff status. Colour =
                 what the migration DOES to the target: green add, amber change, red drop. */
              <span className="text-slate-500 text-[10px] italic">how the target will look after sync</span>
            ) : (
              <>
                {/* Non-table objects (view/function/procedure/trigger) are replaced
                    wholesale, so we diff in MIGRATION direction: current target (left)
                    → desired source (right). Standard diff colours then read correctly —
                    red = removed by the migration, green = added to reach the source
                    definition — instead of being inverted. */}
                <span className="text-slate-500 text-[10px] italic">Target (current)</span>
                <span className="text-slate-600">→</span>
                <span className="text-slate-500 text-[10px] italic">Source (desired)</span>
              </>
            )}
            <span className="ml-1 flex items-center gap-2 text-[10px]">
              {selectedTable.status === 'ADDED' && (
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70"></span><span className="text-emerald-300/80">new object</span></span>
              )}
              {selectedTable.status === 'REMOVED' && (
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/70"></span><span className="text-red-300/80">dropped</span></span>
              )}
              {(selectedTable.status === 'MODIFIED' || selectedTable.status === 'UNCHANGED') && (
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500/70"></span><span className="text-amber-300/80">modified</span></span>
              )}
            </span>
          </span>
          <div className="flex items-center gap-3">
            {isTable ? (
              <span className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">+</span>add</span>
                <span className="flex items-center gap-1"><span className="text-amber-400 font-bold">~</span>change</span>
                <span className="flex items-center gap-1"><span className="text-rose-400 font-bold">−</span>drop</span>
              </span>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          {isTable ? (
            <div className="absolute inset-0 overflow-auto bg-slate-950/90">
              <table className="w-full font-mono text-[12px] border-collapse">
                <tbody>
                  {tableLines.map((line, i) => {
                    const textClass =
                      line.kind === 'added' ? 'text-emerald-300'
                        : line.kind === 'removed' ? 'text-rose-300'
                        : line.kind === 'modified' ? 'text-amber-300'
                        : 'text-slate-300';
                    const rowBg =
                      line.kind === 'added' ? 'bg-emerald-500/10'
                        : line.kind === 'removed' ? 'bg-rose-500/10'
                        : line.kind === 'modified' ? 'bg-amber-500/10'
                        : '';
                    return (
                      <tr key={i} className={rowBg}>
                        <td className={`w-6 text-center select-none align-top ${textClass}`}>{line.marker}</td>
                        <td className={`px-3 py-0.5 whitespace-pre ${textClass} ${line.kind === 'removed' ? 'line-through decoration-rose-500/30' : ''}`}>
                          {highlightMatch(line.text, q)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="absolute inset-0">
              <Suspense fallback={<EditorFallback />}>
                <SqlDiffEditor
                  original={targetDdl}
                  modified={sourceDdl}
                  dialect={targetConfig.dialect}
                  inline={inlineDiff}
                  ignoreCase={ignoreCase}
                  highlight={searchTerm}
                  status={selectedTable.status === 'ADDED' || selectedTable.status === 'REMOVED' ? selectedTable.status : 'MODIFIED'}
                />
              </Suspense>
            </div>
          )}
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
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                selectedTable.status === 'ADDED'    ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/25' :
                selectedTable.status === 'REMOVED'  ? 'text-rose-400 bg-rose-950/40 border-rose-500/25' :
                selectedTable.status === 'MODIFIED' ? 'text-amber-400 bg-amber-950/40 border-amber-500/25' :
                                                      'text-slate-400 bg-slate-800/60 border-slate-700/40'
              }`}>
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
            {sourceConfig.dialect !== targetConfig.dialect && (
              <button
                onClick={() => setShowReadinessDialog(true)}
                className="text-[10px] text-amber-300 font-mono bg-amber-950/40 border border-amber-500/30 px-3 py-1 rounded hover:bg-amber-900/40 transition cursor-pointer"
                title="Cross-dialect migration — click for a per-object-type breakdown of what's translated vs. flagged for manual review"
              >
                Cross-dialect: {sourceConfig.dialect.toUpperCase()} → {targetConfig.dialect.toUpperCase()} · view readiness
              </button>
            )}
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

  // MySQL/MariaDB refuse CREATE FUNCTION/PROCEDURE/TRIGGER when binary logging is on
  // and the connecting user lacks SUPER (error 1419), unless
  // log_bin_trust_function_creators=1. Warn when the migration deploys (creates or
  // recreates) any routine or trigger to a MySQL target. Triggers ride inside a
  // table's ALTER step, so check triggerDiffs as well as top-level routine objects.
  const targetIsMySql = ['mysql', 'mariadb'].includes(targetConfig.dialect.toLowerCase());
  const deploysRoutineToMySql =
    targetIsMySql &&
    (compareResult?.tables ?? []).some((t) => {
      if (!syncSelection[t.tableName]) return false;
      if (
        (t.objectType === 'FUNCTION' || t.objectType === 'PROCEDURE' || t.objectType === 'TRIGGER') &&
        (t.status === 'ADDED' || t.status === 'MODIFIED')
      ) {
        return true;
      }
      return (t.triggerDiffs ?? []).some((d) => d.status === 'ADDED' || d.status === 'MODIFIED');
    });
  const mysqlRiskAcked = mysqlAckSql !== null && mysqlAckSql === generatedSql;

  // Single source of truth for why Execute is disabled, checked in priority order —
  // most severe / least self-service first. `null` means nothing is blocking.
  const executeBlockReason: string | null =
    includedCount === 0 ? 'No objects selected for deployment'
    : !targetConnected ? 'Target connection is not healthy — reconnect before deploying'
    : hasMissingFkTargets ? `${missingFkIssues.length} foreign key(s) reference a table that won't exist in the target — resolve the conflicts below`
    : hasUnresolvedDropDeps ? `${liveDropDeps.length} dependent object(s) would break — resolve the conflicts below`
    : hasNarrowingChanges && !narrowingAcked ? 'Acknowledge the narrowing type changes below before deploying'
    : hasDestructiveDrops && !destructiveDropsAcked ? 'Acknowledge the destructive drops below before deploying'
    : deploysRoutineToMySql && !mysqlRiskAcked ? 'Acknowledge the MySQL binlog privilege risk below before deploying'
    : null;

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
          {/* DDL Diff and Migration SQL are comparison-only — hidden when browsing one schema. */}
          {!browseMode && (
            <>
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
            </>
          )}
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

          {!browseMode && (
          <button
            data-testid="execute-btn"
            onClick={handleExecuteClick}
            disabled={
              isComparing || isMigrating || migrationExecuted || includedCount === 0 ||
              !targetConnected || hasUnresolvedDropDeps ||
              (hasDestructiveDrops && !destructiveDropsAcked) ||
              (deploysRoutineToMySql && !mysqlRiskAcked)
            }
            title={executeBlockReason ?? `Deploy ${includedCount} object(s) to target`}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold transition shadow ${
              migrationExecuted
                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/25 cursor-default'
                : executeBlockReason
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
          )}

          <DependencyWarningDialog
            deps={showDepsDialog ? liveDropDeps : []}
            syncSelection={syncSelection}
            toggleSyncSelection={toggleSyncSelection}
            onCancel={() => setShowDepsDialog(false)}
          />

          <ValidationWarningsDialog
            title="Foreign keys reference a missing table"
            description="These foreign keys point at a table that won't exist in the target once this migration runs. Include the referenced table in the deploy, or deselect the foreign key change."
            issues={showFkDialog ? missingFkIssues : []}
            onCancel={() => setShowFkDialog(false)}
          />

          <ValidationWarningsDialog
            title="Narrowing column type changes"
            description="These columns are changing to a type that can hold less data than before — existing values may be truncated or rejected."
            issues={showNarrowingDialog ? narrowingIssues : []}
            onCancel={() => setShowNarrowingDialog(false)}
          />

          <ValidationWarningsDialog
            title="Manual review notes"
            description="The generator flagged these — usually a cross-dialect type mapping with no exact equivalent, or a procedural body it couldn't auto-translate. The migration is still runnable; review these before deploying."
            issues={showReviewDialog ? reviewIssues : []}
            onCancel={() => setShowReviewDialog(false)}
          />

          <CrossDialectReadinessDialog
            open={showReadinessDialog}
            sourceDialect={sourceConfig.dialect}
            targetDialect={targetConfig.dialect}
            onClose={() => setShowReadinessDialog(false)}
          />

          <DeployConfirmDialog
            open={showConfirm}
            dialect={targetConfig.dialect}
            count={includedCount}
            dontAskAgain={dontAskAgain}
            onToggleDontAsk={setDontAskAgain}
            onCancel={() => setShowConfirm(false)}
            onConfirm={confirmExecute}
          />
        </div>
      </div>

      {/* Safety gate banner — anything that currently blocks Execute, with the
          action needed to clear it. Visible on every tab, not just Migration SQL,
          since Execute lives in the toolbar above regardless of active tab. */}
      {!browseMode && (!targetConnected || hasMissingFkTargets || hasUnresolvedDropDeps || hasNarrowingChanges || (hasDestructiveDrops && !destructiveDropsAcked) || (deploysRoutineToMySql && !mysqlRiskAcked) || reviewIssues.length > 0) && (
        <div className="border-b border-slate-800 bg-slate-950/60 divide-y divide-slate-800/60">
          {!targetConnected && (
            <div className="flex items-center gap-2.5 px-4 py-2 text-[11px] text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
              Target connection is not healthy — reconnect the target before deploying.
            </div>
          )}
          {hasMissingFkTargets && (
            <div className="flex items-center justify-between gap-2.5 px-4 py-2 text-[11px] text-rose-200">
              <span className="flex items-center gap-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                {missingFkIssues.length} foreign key{missingFkIssues.length === 1 ? '' : 's'} would reference a table missing from the target.
              </span>
              <button
                onClick={() => setShowFkDialog(true)}
                className="shrink-0 text-[10px] font-semibold rounded px-2 py-1 text-rose-200 bg-rose-950/50 border border-rose-500/40 hover:bg-rose-900/50 transition"
              >
                Review conflicts
              </button>
            </div>
          )}
          {hasUnresolvedDropDeps && (
            <div className="flex items-center justify-between gap-2.5 px-4 py-2 text-[11px] text-amber-200">
              <span className="flex items-center gap-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                {liveDropDeps.length} dependent object{liveDropDeps.length === 1 ? '' : 's'} would break from a drop in this deploy.
              </span>
              <button
                onClick={() => setShowDepsDialog(true)}
                className="shrink-0 text-[10px] font-semibold rounded px-2 py-1 text-amber-200 bg-amber-950/50 border border-amber-500/40 hover:bg-amber-900/50 transition"
              >
                Review conflicts
              </button>
            </div>
          )}
          {hasNarrowingChanges && (
            <label className="flex items-center gap-2.5 px-4 py-2 text-[11px] text-amber-200 cursor-pointer">
              <input
                data-testid="ack-narrowing-types"
                type="checkbox"
                checked={narrowingAcked}
                onChange={(e) => setNarrowingAckSql(e.target.checked ? generatedSql : null)}
                className="w-3 h-3 accent-amber-500 cursor-pointer shrink-0"
              />
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              {narrowingIssues.length} column type change{narrowingIssues.length === 1 ? '' : 's'} may truncate or reject existing data —{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowNarrowingDialog(true);
                }}
                className="underline hover:text-amber-100"
              >
                view details
              </button>
              . I understand and want to proceed.
            </label>
          )}
          {reviewIssues.length > 0 && (
            <div className="flex items-center justify-between gap-2.5 px-4 py-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                {reviewIssues.length} note{reviewIssues.length === 1 ? '' : 's'} in the generated SQL need manual review.
              </span>
              <button
                onClick={() => setShowReviewDialog(true)}
                className="shrink-0 text-[10px] font-semibold rounded px-2 py-1 text-slate-300 bg-slate-800/50 border border-slate-700/40 hover:bg-slate-800 transition"
              >
                View notes
              </button>
            </div>
          )}
          {hasDestructiveDrops && (
            <label className="flex items-center gap-2.5 px-4 py-2 text-[11px] text-amber-200 cursor-pointer">
              <input
                data-testid="ack-destructive-drops"
                type="checkbox"
                checked={destructiveDropsAcked}
                onChange={(e) => setDestructiveAckSql(e.target.checked ? generatedSql : null)}
                className="w-3 h-3 accent-amber-500 cursor-pointer shrink-0"
              />
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              This migration drops table(s), column(s), or index(es) that cannot be recovered — I understand and want to proceed.
            </label>
          )}
          {deploysRoutineToMySql && (
            <label className="flex items-center gap-2.5 px-4 py-2 text-[11px] text-amber-200 cursor-pointer">
              <input
                data-testid="ack-mysql-binlog-risk"
                type="checkbox"
                checked={mysqlRiskAcked}
                onChange={(e) => setMysqlAckSql(e.target.checked ? generatedSql : null)}
                className="w-3 h-3 accent-amber-500 cursor-pointer shrink-0"
              />
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              This deploy creates/updates a MySQL function, procedure, or trigger — the connecting user needs SUPER or{' '}
              <code className="text-amber-100">log_bin_trust_function_creators = 1</code> or it will fail. I've confirmed this.
            </label>
          )}
        </div>
      )}

      {/* Main Panel Content Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        {browseMode || activeTab === 'DIFF' ? (
          renderSchemaObjectDiff()
        ) : activeTab === 'DDL_DIFF' ? (
          renderDdlDiff()
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-950/90 border-t border-slate-850">
            {deploysRoutineToMySql && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-950/40 border-b border-amber-500/30 text-[11px] text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="leading-relaxed">
                  <span className="font-bold text-amber-300">MySQL routine/trigger deploy:</span> with binary
                  logging enabled, <code className="text-amber-100">CREATE FUNCTION/PROCEDURE/TRIGGER</code>{' '}
                  requires the <code className="text-amber-100">SUPER</code> privilege (error 1419). If the
                  connecting user lacks it, have a DBA run{' '}
                  <code className="text-amber-100">SET GLOBAL log_bin_trust_function_creators = 1;</code> once
                  (or set it in <code className="text-amber-100">my.cnf</code>) before deploying — or use{' '}
                  <span className="font-semibold text-amber-100">Skip &amp; retry</span> in the progress panel
                  to deploy everything else.
                </div>
              </div>
            )}
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

      <MigrationProgressPanel />
    </div>
  );
};
