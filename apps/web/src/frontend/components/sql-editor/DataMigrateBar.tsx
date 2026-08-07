/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Side-by-side data migrate: key-based insert/update/delete onto a destination
 * grid (≤500 ops). Larger sets toast with Server Beam instructions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, CheckCheck, History, Loader2, X } from 'lucide-react';
import {
  apiExecuteDataMigrate,
  apiFinishDataMigrate,
  apiGetDataMigration,
  apiListDataMigrations,
  apiStartDataMigrate,
  type DataMigrateOpResult,
  type DataMigrateRunDetail,
  type DataMigrateRunSummary,
} from '../../api/dataMigrateApi';
import { buildDataMigratePlans, buildDestSnapshotJson } from '../../lib/dataMigratePlans';
import {
  classifyRowsByKey,
  DATA_MIGRATE_ROW_CAP,
  diffKeyLabelsForOps,
  filterOpsByKeyLabels,
  migrateGridsAreComplete,
  selectMigrateOps,
  type ClassifiedRowDiff,
} from '../../lib/resultRowDiff';
import { assessPeekEditability, resolvePeekKeyColumns } from '../../lib/rowDml';
import { singleTableForResultEdit } from '../../lib/tablePreview';
import type { TableSchema } from '../../lib/types';
import { toast } from '../../store/toastStore';
import { useAuthStore } from '../../store/authStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { useSyncStore } from '../../store/useSyncStore';
import { SQL_ICON_STROKE } from './sqlIconStyle';

export interface DataMigrateGrid {
  connectionId: string;
  dialect: string;
  label: string;
  columns: string[];
  rows: unknown[][];
  statementSql?: string;
  /** 0-based page currently shown in the result grid. */
  pageIndex?: number;
  /** True when more rows exist beyond this page (hasNext / truncated). */
  hasMore?: boolean;
}

type ProgressItem = {
  keyLabel: string;
  op: ClassifiedRowDiff['op'];
  status: 'pending' | 'running' | 'ok' | 'fail' | 'skipped';
  error?: string;
};

interface Props {
  statementIndex: number;
  source: DataMigrateGrid;
  dest: DataMigrateGrid;
  /** Trigger/audit columns excluded from UPDATE detection and INSERT/UPDATE SET. */
  ignoreColumns?: string[];
  /** Controlled key columns (shared with Compare alignment). */
  keyNames?: string[];
  onKeyNamesChange?: (names: string[]) => void;
  /** Row Sync checkboxes — which differing keys to include in migrate. */
  selectedSyncKeys?: ReadonlySet<string>;
  onSelectedSyncKeysChange?: (keys: Set<string>) => void;
  onAfterMigrate?: () => void;
  onOpenServerBeamSample?: () => void;
}

export const DataMigrateBar: React.FC<Props> = ({
  statementIndex,
  source,
  dest,
  ignoreColumns = [],
  keyNames: keyNamesProp = [],
  onKeyNamesChange,
  selectedSyncKeys = new Set(),
  onSelectedSyncKeysChange,
  onAfterMigrate,
  onOpenServerBeamSample,
}) => {
  const canDml = useAuthStore((s) => s.can('editor.dml'));
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const schemaCache = useSqlEditorStore((s) => s.schemaCache);
  const connections = useSyncStore((s) => s.connections);
  const destConn = connections.find((c) => c.id === dest.connectionId);
  const sourceConn = connections.find((c) => c.id === source.connectionId);
  const destSchema = destConn?.schema;
  const tables = schemaCache[dest.connectionId]?.tables;

  const editTarget = useMemo(() => {
    if (!source.statementSql) return { ok: false as const, reason: 'No statement SQL' };
    return singleTableForResultEdit(source.statementSql, tables, destSchema);
  }, [source.statementSql, tables, destSchema]);

  const table: TableSchema | undefined = editTarget.ok ? editTarget.table : undefined;
  const tableName = table?.name ?? '';

  const preferredKeyNames = useMemo(
    () =>
      resolvePeekKeyColumns(table, source.columns)
        .filter((k) => k.resultIndex >= 0)
        .map((k) => k.name),
    [table, source.columns]
  );

  const sharedColumns = useMemo(() => {
    const destLower = new Set(dest.columns.map((c) => c.toLowerCase()));
    return source.columns.filter((c) => destLower.has(c.toLowerCase()));
  }, [source.columns, dest.columns]);

  const keyNames = keyNamesProp;

  const toggleKeyColumn = (col: string) => {
    if (!onKeyNamesChange) return;
    const lower = col.toLowerCase();
    const has = keyNames.some((k) => k.toLowerCase() === lower);
    if (has) {
      const next = keyNames.filter((k) => k.toLowerCase() !== lower);
      if (next.length === 0) return;
      onKeyNamesChange(next);
    } else {
      onKeyNamesChange([...keyNames, col]);
    }
  };

  /** Ops default on when that op has rows — Sync alone can enable Migrate. */
  const [doInsert, setDoInsert] = useState(true);
  const [doUpdate, setDoUpdate] = useState(true);
  const [doDelete, setDoDelete] = useState(true);
  const [includeIdentity, setIncludeIdentity] = useState(false);
  /** Safety: one transaction for the whole batch (Stop mode). Off with Continue = per-op commits. */
  const [useTransaction, setUseTransaction] = useState(true);
  /** Safety: Continue = skip failures; Stop = abort (rollback if transaction on). */
  const [continueOnError, setContinueOnError] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[] | null>(null);
  const [failedSummary, setFailedSummary] = useState<DataMigrateOpResult[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<DataMigrateRunSummary[]>([]);
  const [historyDetail, setHistoryDetail] = useState<DataMigrateRunDetail | null>(null);

  const editability = useMemo(
    () => assessPeekEditability({ dialect: dest.dialect, table, resultColumns: source.columns }),
    [dest.dialect, table, source.columns]
  );

  const classification = useMemo(
    () =>
      classifyRowsByKey({
        source: { columns: source.columns, rows: source.rows },
        dest: { columns: dest.columns, rows: dest.rows },
        keyNames,
        ignoreColumns,
      }),
    [source.columns, source.rows, dest.columns, dest.rows, keyNames, ignoreColumns]
  );

  const opsEnabled = useMemo(
    () => ({ insert: doInsert, update: doUpdate, delete: doDelete }),
    [doInsert, doUpdate, doDelete]
  );

  /** Sync checkboxes track enabled Ops — uncheck Add/Edit/Delete clears those Sync rows. */
  const enabledSyncLabelsKey = useMemo(
    () => diffKeyLabelsForOps(classification, opsEnabled).join('\0'),
    [classification, opsEnabled]
  );

  useEffect(() => {
    if (!onSelectedSyncKeysChange) return;
    const labels = enabledSyncLabelsKey
      ? enabledSyncLabelsKey.split('\0').filter(Boolean)
      : [];
    onSelectedSyncKeysChange(new Set(labels));
  }, [enabledSyncLabelsKey, onSelectedSyncKeysChange]);

  const selected = useMemo(
    () => selectMigrateOps(classification, opsEnabled),
    [classification, opsEnabled]
  );

  const filtered = useMemo(
    () => filterOpsByKeyLabels(selected.ops, selectedSyncKeys, DATA_MIGRATE_ROW_CAP),
    [selected.ops, selectedSyncKeys]
  );

  const syncAll = () => {
    if (!onSelectedSyncKeysChange) return;
    onSelectedSyncKeysChange(new Set(diffKeyLabelsForOps(classification, opsEnabled)));
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      const runs = await apiListDataMigrations();
      setHistoryRuns(runs);
      if (runs[0]) {
        setHistoryDetail(await apiGetDataMigration(runs[0].id));
      } else {
        setHistoryDetail(null);
      }
    } catch (e) {
      toast({
        tone: 'warning',
        title: 'Could not load data migrate history',
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const apply = async () => {
    if (applying || !canDml) return;
    if (!editTarget.ok || !table) {
      toast({
        tone: 'warning',
        title: 'Data migrate needs a single-table SELECT',
        body: editTarget.ok ? 'Table not found in schema cache.' : editTarget.reason,
      });
      return;
    }
    if (keyNames.length === 0) {
      toast({
        tone: 'warning',
        title: 'Pick at least one Key column',
        body: 'Check a shared column under Keys (for example ATTRIBUTENAME) so rows can match.',
      });
      return;
    }
    const keysMissing = keyNames.filter(
      (k) =>
        !source.columns.some((c) => c.toLowerCase() === k.toLowerCase()) ||
        !dest.columns.some((c) => c.toLowerCase() === k.toLowerCase())
    );
    if (keysMissing.length > 0) {
      toast({
        tone: 'warning',
        title: 'Key columns missing from the result',
        body: `Include ${keysMissing.join(', ')} in the SELECT, or pick a Key that is in both grids.`,
      });
      return;
    }
    // Allow business/name keys when the table PK isn't in the SELECT.
    // Block only when schema says PK is in the result but editability still failed.
    if (!editability.editable && preferredKeyNames.length > 0) {
      toast({
        tone: 'warning',
        title: 'Data migrate needs a unique key in the result',
        body:
          editability.reason ||
          'Include the primary key (or a non-partial unique index) columns in the SELECT.',
      });
      return;
    }
    if (
      !migrateGridsAreComplete({
        sourcePageIndex: source.pageIndex ?? 0,
        destPageIndex: dest.pageIndex ?? 0,
        sourceHasMore: Boolean(source.hasMore),
        destHasMore: Boolean(dest.hasMore),
      })
    ) {
      toast({
        tone: 'warning',
        title: 'Migrate needs the full result on page 1',
        body:
          'Add / Edit / Delete classify only the rows currently loaded. ' +
          'Page both grids to page 1 with no “next page”, or tighten the SELECT ' +
          `(LIMIT ≤ page size). Otherwise Delete can remove destination rows that ` +
          'still exist later in the source.',
      });
      return;
    }
    if (selected.uncappedCount === 0) {
      toast({ tone: 'info', title: 'Nothing to migrate', body: 'Grids match for the selected ops.' });
      return;
    }
    if (filtered.uncappedCount === 0) {
      toast({
        tone: 'warning',
        title: 'No rows selected for Sync',
        body:
          'You chose Add / Edit / Delete but no differing rows are checked. ' +
          'Use the Sync column on the destination grid or click Sync all.',
      });
      return;
    }
    if (classification.duplicateKeys > 0) {
      toast({
        tone: 'warning',
        title: 'Duplicate keys in result grids',
        body:
          `${classification.duplicateKeys} duplicate key value(s) — migrate refuses to guess which row to write. ` +
          'Tighten the SELECT (DISTINCT / better keys) or pick a unique key set.',
      });
      return;
    }
    if (filtered.uncappedCount > DATA_MIGRATE_ROW_CAP) {
      toast({
        tone: 'warning',
        title: `Over ${DATA_MIGRATE_ROW_CAP} row ops — use Server Beam`,
        body:
          `This compare has ${filtered.uncappedCount} insert/update/delete ops. ` +
          `Side-by-side migrate is limited to ${DATA_MIGRATE_ROW_CAP} rows. ` +
          'Check source then target Destinations, turn Safe mode off, and run the ' +
          'Server Beam chunked sample (Bookmarks → Add samples).',
        actionButtonLabel: 'Insert Server Beam sample',
        onAction: onOpenServerBeamSample,
        durationMs: 14_000,
      });
      return;
    }

    const { plans, errors } = buildDataMigratePlans({
      tableName,
      dialect: dest.dialect,
      sourceColumns: source.columns,
      destColumns: dest.columns,
      keyNames,
      ops: filtered.ops,
      includeIdentity,
      identityColumns: editability.identityColumns,
      ignoreColumns,
    });
    if (errors.length) {
      toast({
        tone: 'warning',
        title: 'Some plans could not be built',
        body: errors.slice(0, 3).join(' · '),
      });
    }
    if (plans.length === 0) return;

    const snapshotJson = buildDestSnapshotJson({
      destColumns: dest.columns,
      ops: filtered.ops,
    });
    const script = [
      `-- useTransaction=${useTransaction} continueOnError=${continueOnError}`,
      ...plans.map((p) => `-- ${p.op} ${p.keyLabel}\n${p.plan.displaySql};`),
    ].join('\n\n');

    setApplying(true);
    setFailedSummary([]);
    setProgress(
      plans.map((p) => ({
        keyLabel: p.keyLabel,
        op: p.op,
        status: 'pending' as const,
      }))
    );

    let runId: string | null = null;
    try {
      runId = await apiStartDataMigrate({
        dialect: dest.dialect,
        sourceHost: sourceConn?.host || source.label,
        targetHost: destConn?.host || dest.label,
        database: destConn?.database,
        schema: destConn?.schema,
        tableName,
        rowCount: plans.length,
        opsEnabled: { insert: doInsert, update: doUpdate, delete: doDelete },
        includeIdentity,
        keyColumns: keyNames,
        script,
        snapshotJson,
      });
    } catch (e) {
      toast({
        tone: 'warning',
        title: 'Could not start history record',
        body: e instanceof Error ? e.message : String(e),
      });
    }

    let results: DataMigrateOpResult[] = [];
    let failCount = 0;
    let rolledBack = false;

    try {
      setProgress((prev) => prev?.map((p) => ({ ...p, status: 'running' })) ?? prev);
      const out = await apiExecuteDataMigrate(
        {
          connectionId: dest.connectionId,
          password: sessionPasswords[dest.connectionId] || undefined,
          schema: destConn?.schema?.trim() || undefined,
        },
        plans.map((p) => ({
          op: p.op,
          key: p.keyLabel,
          sql: p.plan.sql,
          params: p.plan.params,
        })),
        { useTransaction, continueOnError }
      );
      results = out.results;
      failCount = out.failCount;
      rolledBack = out.rolledBack;
      setProgress(
        results.map((r) => ({
          keyLabel: r.key,
          op: r.op,
          status:
            r.status === 'SUCCESS' ? 'ok' : r.status === 'SKIPPED' ? 'skipped' : 'fail',
          error: r.error,
        }))
      );
      setFailedSummary(results.filter((r) => r.status === 'FAILED'));
    } catch (e) {
      failCount = plans.length;
      const msg = e instanceof Error ? e.message : String(e);
      results = plans.map((p) => ({
        op: p.op,
        key: p.keyLabel,
        status: 'FAILED' as const,
        error: msg,
      }));
      setProgress(
        plans.map((p) => ({
          keyLabel: p.keyLabel,
          op: p.op,
          status: 'fail' as const,
          error: msg,
        }))
      );
      setFailedSummary(results);
    }

    const status =
      failCount === 0
        ? 'SUCCESS'
        : failCount === plans.length || rolledBack
          ? 'FAILED'
          : 'PARTIAL_SUCCESS';
    if (runId) {
      try {
        await apiFinishDataMigrate(runId, { status, results });
      } catch {
        /* history best-effort */
      }
    }

    setApplying(false);
    const failedKeys = results
      .filter((r) => r.status === 'FAILED')
      .map((r) => `${r.op} ${r.key}`)
      .slice(0, 5);
    toast({
      tone: failCount === 0 ? 'success' : 'warning',
      title:
        failCount === 0
          ? `Migrated ${plans.length} row ops`
          : rolledBack
            ? `Rolled back — ${failCount} failure(s)`
            : `Finished with ${failCount} failure(s)`,
      body:
        failCount === 0
          ? `Destination: ${dest.label}. Snapshot + history saved.`
          : `Failed: ${failedKeys.join('; ')}${
              results.filter((r) => r.status === 'FAILED').length > 5 ? '…' : ''
            }. ${rolledBack ? 'Transaction rolled back. ' : ''}See progress / history.`,
      actionButtonLabel: 'View history',
      onAction: () => void openHistory(),
      durationMs: 10_000,
    });
    if (!rolledBack) await onAfterMigrate?.();
  };

  if (!canCompareReady(source, dest)) return null;

  const migrateCount = filtered.uncappedCount;
  const overCap = migrateCount > DATA_MIGRATE_ROW_CAP;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-sky-500/40 bg-gradient-to-br from-slate-950/90 via-slate-900/80 to-sky-950/40 px-3 py-2.5 shadow-sm shadow-sky-500/10"
      data-testid={`sql-data-migrate-bar-${statementIndex}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-bold text-slate-300">
        <span className="inline-flex items-center gap-1.5 text-sky-300">
          <ArrowRightLeft className="w-4 h-4" strokeWidth={SQL_ICON_STROKE} />
          Data migrate
        </span>
        <span className="text-slate-400 truncate max-w-[20rem] font-semibold" title={`${source.label} → ${dest.label}`}>
          {source.label} → {dest.label}
        </span>
        <span className="text-slate-500 font-semibold text-[11px]">
          {classification.inserts.length} add · {classification.updates.length} edit ·{' '}
          {classification.deletes.length} delete available
          {selected.uncappedCount > migrateCount
            ? ` · ${migrateCount} synced`
            : ''}
          {overCap ? ` · capped ${DATA_MIGRATE_ROW_CAP}` : ''}
        </span>
        <button
          type="button"
          data-testid={`sql-data-migrate-history-${statementIndex}`}
          onClick={() => void openHistory()}
          className="inline-flex items-center gap-1 text-slate-500 hover:text-cyan-400 font-semibold text-[11px]"
        >
          <History className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} /> History
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] font-semibold text-slate-400">
        <span className="text-sky-400/90 shrink-0">Keys</span>
        {sharedColumns.length > 0 ? (
          sharedColumns.map((col) => {
            const checked = keyNames.some((k) => k.toLowerCase() === col.toLowerCase());
            const preferred = preferredKeyNames.some((k) => k.toLowerCase() === col.toLowerCase());
            return (
              <label
                key={col}
                className={`inline-flex items-center gap-1 cursor-pointer select-none rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                  checked
                    ? 'border-sky-500/50 bg-sky-950/60 text-sky-200'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600'
                }`}
                title={
                  preferred
                    ? 'Primary key / unique index column (recommended)'
                    : 'Shared column — check to align and match rows'
                }
              >
                <input
                  type="checkbox"
                  data-testid={`sql-data-migrate-key-${col}-${statementIndex}`}
                  checked={checked}
                  onChange={() => toggleKeyColumn(col)}
                  className="rounded border-slate-600 accent-sky-500"
                />
                {col}
                {preferred ? (
                  <span className="text-[9px] uppercase tracking-wide text-emerald-400/90">pk</span>
                ) : null}
              </label>
            );
          })
        ) : (
          <span className="text-amber-400/90">
            No shared columns between source and destination grids.
          </span>
        )}
        {keyNames.length === 0 && sharedColumns.length > 0 && (
          <span className="text-amber-400/90">Pick at least one key column.</span>
        )}
        {preferredKeyNames.length === 0 && sharedColumns.length > 0 && (
          <span className="text-amber-400/90 text-[10px]">
            No PK in this SELECT — check a Key (e.g. {sharedColumns[0]}) to align rows and show Sync.
          </span>
        )}
        {preferredKeyNames.length === 0 && sharedColumns.length === 0 && editability.reason && (
          <span className="text-amber-400/90 text-[10px]">{editability.reason}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] font-semibold text-slate-400">
        <span className="text-sky-400/90 shrink-0" title="Choose which row ops to apply — nothing runs until you check an op.">
          Ops
        </span>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-emerald-200">
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-insert-${statementIndex}`}
            checked={doInsert}
            onChange={(e) => setDoInsert(e.target.checked)}
            className="rounded border-emerald-600 accent-emerald-500"
          />
          Add ({classification.inserts.length})
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-amber-200">
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-update-${statementIndex}`}
            checked={doUpdate}
            onChange={(e) => setDoUpdate(e.target.checked)}
            className="rounded border-amber-600 accent-amber-500"
          />
          Edit ({classification.updates.length})
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none rounded-md border border-rose-500/40 bg-rose-950/40 px-2 py-0.5 text-rose-200">
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-delete-${statementIndex}`}
            checked={doDelete}
            onChange={(e) => setDoDelete(e.target.checked)}
            className="rounded border-rose-600 accent-rose-500"
          />
          Delete ({classification.deletes.length})
        </label>
        <button
          type="button"
          data-testid={`sql-data-migrate-sync-all-${statementIndex}`}
          onClick={syncAll}
          className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-950/50 px-2 py-0.5 text-sky-200 hover:bg-sky-900/60"
          title="Re-check Sync for rows matching the enabled Add / Edit / Delete ops"
        >
          <CheckCheck className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
          Sync all
        </button>
        <label
          className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-500"
          title="When on, Add includes identity/autoincrement values from the source (preserve IDs). When off, the destination generates them."
        >
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-identity-${statementIndex}`}
            checked={includeIdentity}
            onChange={(e) => setIncludeIdentity(e.target.checked)}
            className="rounded border-slate-600"
          />
          Include identity / IDs
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-400">
        <span
          className="text-sky-400/90 shrink-0"
          title="Safety assists — you choose the ops; we help contain failures."
        >
          Safety
        </span>
        <label
          className="inline-flex items-center gap-1 cursor-pointer select-none"
          title="Wrap all ops in one transaction when Stop is selected. With Continue, each op uses its own transaction so a failure only rolls back that row."
        >
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-tx-${statementIndex}`}
            checked={useTransaction}
            onChange={(e) => setUseTransaction(e.target.checked)}
            className="rounded border-slate-600"
          />
          Transaction
        </label>
        <label
          className="inline-flex items-center gap-1 cursor-pointer select-none"
          title="Continue: keep applying after a failed row. Stop: abort (and roll back the whole batch when Transaction is on)."
        >
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-continue-${statementIndex}`}
            checked={continueOnError}
            onChange={(e) => setContinueOnError(e.target.checked)}
            className="rounded border-slate-600"
          />
          {continueOnError ? 'Continue on error' : 'Stop on error'}
        </label>
        <button
          type="button"
          data-testid={`sql-data-migrate-apply-${statementIndex}`}
          disabled={
            applying ||
            !canDml ||
            selected.uncappedCount === 0 ||
            migrateCount === 0 ||
            classification.duplicateKeys > 0 ||
            overCap
          }
          onClick={() => void apply()}
          className="ml-auto px-3 py-1 rounded-md bg-cyan-600/50 border border-cyan-400/50 text-sm font-bold text-cyan-100 hover:bg-cyan-500/60 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-cyan-500/20"
          title={
            selected.uncappedCount === 0
              ? 'Select Add, Edit, and/or Delete first'
              : migrateCount === 0
                ? 'Check rows in the Sync column'
                : overCap
                  ? `Over ${DATA_MIGRATE_ROW_CAP} ops — use Server Beam`
                  : undefined
          }
        >
          {applying ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} /> Migrating…
            </span>
          ) : overCap ? (
            `Over ${DATA_MIGRATE_ROW_CAP} — Server Beam`
          ) : selected.uncappedCount === 0 ? (
            'Select ops to migrate'
          ) : migrateCount === 0 ? (
            'Select Sync rows'
          ) : (
            `Migrate ${migrateCount} ops`
          )}
        </button>
      </div>

      {!editTarget.ok && (
        <p className="text-[11px] font-semibold text-amber-400/90">
          Migrate needs a single-table SELECT with schema loaded on the destination.
        </p>
      )}

      {failedSummary.length > 0 && (
        <div
          className="rounded border border-rose-500/30 bg-rose-950/30 px-2 py-1.5 text-[10px]"
          data-testid={`sql-data-migrate-failures-${statementIndex}`}
        >
          <div className="font-bold text-rose-300 mb-1">
            Failed records ({failedSummary.length})
          </div>
          <ul className="space-y-0.5 font-mono text-rose-200/90 max-h-24 overflow-auto">
            {failedSummary.map((r, i) => (
              <li key={`${r.op}-${r.key}-${i}`} title={r.error}>
                <span className="uppercase text-rose-400">{r.op}</span> {r.key}
                {r.error ? ` — ${r.error}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {progress &&
        createPortal(
          <div
            className="fixed bottom-4 right-4 z-[360] w-[24rem] max-h-[50vh] overflow-auto rounded-lg border border-slate-700 bg-slate-950 shadow-xl"
            data-testid="sql-data-migrate-progress"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-200">Data migrate progress</span>
              {!applying && (
                <button
                  type="button"
                  onClick={() => setProgress(null)}
                  className="text-slate-500 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
                </button>
              )}
            </div>
            <ul className="px-3 py-2 space-y-1 text-[10px] font-mono">
              {progress.map((p, i) => (
                <li key={`${p.op}-${p.keyLabel}-${i}`} className="flex items-start gap-2">
                  <span
                    className={
                      p.status === 'ok'
                        ? 'text-emerald-400'
                        : p.status === 'fail'
                          ? 'text-rose-400'
                          : p.status === 'skipped'
                            ? 'text-amber-400'
                            : p.status === 'running'
                              ? 'text-cyan-400'
                              : 'text-slate-500'
                    }
                  >
                    {p.status === 'running'
                      ? '…'
                      : p.status === 'ok'
                        ? '✓'
                        : p.status === 'fail'
                          ? '✗'
                          : p.status === 'skipped'
                            ? '–'
                            : '·'}
                  </span>
                  <span className="text-slate-400 uppercase w-12 shrink-0">{p.op}</span>
                  <span className="text-slate-300 min-w-0 break-all" title={p.error}>
                    {p.keyLabel}
                    {p.error ? (
                      <span className="block text-rose-400/90 font-sans normal-case">{p.error}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}

      {historyOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[370] flex items-center justify-center bg-black/50 p-4"
            data-testid="sql-data-migrate-history-modal"
            onClick={() => setHistoryOpen(false)}
          >
            <div
              className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-lg border border-slate-700 bg-slate-950 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                <span className="text-sm font-bold text-slate-100">Data migrate history</span>
                <button type="button" onClick={() => setHistoryOpen(false)} className="text-slate-500">
                  <X className="w-4 h-4" strokeWidth={SQL_ICON_STROKE} />
                </button>
              </div>
              <div className="flex min-h-0 flex-1">
                <ul className="w-48 shrink-0 border-r border-slate-800 overflow-y-auto text-[11px]">
                  {historyRuns.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`w-full text-left px-2 py-1.5 hover:bg-slate-900 ${
                          historyDetail?.id === r.id ? 'bg-slate-900 text-cyan-300' : 'text-slate-400'
                        }`}
                        onClick={() => void apiGetDataMigration(r.id).then(setHistoryDetail)}
                      >
                        <div className="font-semibold">{r.status}</div>
                        <div className="truncate">{r.tableName || r.targetHost || '—'}</div>
                        <div className="text-slate-600">{new Date(r.startedAt).toLocaleString()}</div>
                      </button>
                    </li>
                  ))}
                  {historyRuns.length === 0 && (
                    <li className="px-2 py-3 text-slate-600">No runs yet</li>
                  )}
                </ul>
                <div className="flex-1 overflow-auto p-3 text-[11px] text-slate-300 space-y-2">
                  {historyDetail ? (
                    <>
                      <div>
                        <span className="text-slate-500">Table</span> {historyDetail.tableName} ·{' '}
                        {historyDetail.rowCount} ops · keys [{historyDetail.keyColumns.join(', ')}]
                      </div>
                      <div>
                        <span className="text-slate-500">Snapshot (pre-apply dest rows)</span>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-400">
                          {historyDetail.snapshotJson || '(none)'}
                        </pre>
                      </div>
                      <div>
                        <span className="text-slate-500">Script</span>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-400">
                          {historyDetail.script || '(none)'}
                        </pre>
                      </div>
                      <div>
                        <span className="text-slate-500">Results</span>
                        <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
                          {historyDetail.results.map((r, i) => (
                            <li key={i} className={r.status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}>
                              {r.status} {r.op} {r.key}
                              {r.error ? ` — ${r.error}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : (
                    <p className="text-slate-600">Select a run</p>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

function canCompareReady(source: DataMigrateGrid, dest: DataMigrateGrid): boolean {
  return Boolean(source.columns.length && dest.columns.length);
}
