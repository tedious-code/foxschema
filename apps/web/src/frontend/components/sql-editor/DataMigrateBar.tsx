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
import { ArrowRightLeft, History, Loader2, X } from 'lucide-react';
import { executeSql } from '../../api/sqlApi';
import {
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
}

type ProgressItem = {
  keyLabel: string;
  op: ClassifiedRowDiff['op'];
  status: 'pending' | 'running' | 'ok' | 'fail';
  error?: string;
};

interface Props {
  statementIndex: number;
  source: DataMigrateGrid;
  dest: DataMigrateGrid;
  onAfterMigrate?: () => void;
  onOpenServerBeamSample?: () => void;
}

export const DataMigrateBar: React.FC<Props> = ({
  statementIndex,
  source,
  dest,
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

  const defaultKeys = useMemo(
    () => resolvePeekKeyColumns(table, source.columns).map((k) => k.name),
    [table, source.columns]
  );

  const [keyNames, setKeyNames] = useState<string[]>([]);
  useEffect(() => {
    setKeyNames(defaultKeys.length ? defaultKeys : source.columns.slice(0, 1));
  }, [defaultKeys.join('\0'), source.columns.join('\0')]);

  const [doInsert, setDoInsert] = useState(true);
  const [doUpdate, setDoUpdate] = useState(true);
  const [doDelete, setDoDelete] = useState(false);
  const [includeIdentity, setIncludeIdentity] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[] | null>(null);
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
      }),
    [source.columns, source.rows, dest.columns, dest.rows, keyNames]
  );

  const selected = useMemo(
    () =>
      selectMigrateOps(classification, {
        insert: doInsert,
        update: doUpdate,
        delete: doDelete,
      }),
    [classification, doInsert, doUpdate, doDelete]
  );

  const toggleKey = (name: string) => {
    setKeyNames((prev) =>
      prev.some((k) => k.toLowerCase() === name.toLowerCase())
        ? prev.filter((k) => k.toLowerCase() !== name.toLowerCase())
        : [...prev, name]
    );
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
      toast({ tone: 'warning', title: 'Select at least one key column' });
      return;
    }
    if (selected.uncappedCount === 0) {
      toast({ tone: 'info', title: 'Nothing to migrate', body: 'Grids match for the selected ops.' });
      return;
    }
    if (selected.uncappedCount > DATA_MIGRATE_ROW_CAP) {
      toast({
        tone: 'warning',
        title: `Over ${DATA_MIGRATE_ROW_CAP} row ops — use Server Beam`,
        body:
          `This compare has ${selected.uncappedCount} insert/update/delete ops. ` +
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
      ops: selected.ops,
      includeIdentity,
      identityColumns: editability.identityColumns,
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
      ops: selected.ops,
    });
    const script = plans.map((p) => `-- ${p.op} ${p.keyLabel}\n${p.plan.displaySql};`).join('\n\n');

    setApplying(true);
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

    const results: DataMigrateOpResult[] = [];
    let failCount = 0;

    for (let i = 0; i < plans.length; i++) {
      const item = plans[i]!;
      setProgress((prev) =>
        prev
          ? prev.map((p, idx) => (idx === i ? { ...p, status: 'running' } : p))
          : prev
      );
      try {
        const { results: execResults } = await executeSql(
          {
            connectionId: dest.connectionId,
            password: sessionPasswords[dest.connectionId] || undefined,
            schema: destConn?.schema?.trim() || undefined,
          },
          [item.plan.sql],
          undefined,
          undefined,
          item.plan.params.length ? [item.plan.params] : undefined,
          { datagridAction: item.op }
        );
        const failed = execResults.find((r) => !r.ok);
        if (failed && !failed.ok) {
          failCount += 1;
          results.push({
            op: item.op,
            key: item.keyLabel,
            status: 'FAILED',
            error: failed.error,
          });
          setProgress((prev) =>
            prev
              ? prev.map((p, idx) =>
                  idx === i ? { ...p, status: 'fail', error: failed.error } : p
                )
              : prev
          );
        } else {
          results.push({ op: item.op, key: item.keyLabel, status: 'SUCCESS' });
          setProgress((prev) =>
            prev
              ? prev.map((p, idx) => (idx === i ? { ...p, status: 'ok' } : p))
              : prev
          );
        }
      } catch (e) {
        failCount += 1;
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ op: item.op, key: item.keyLabel, status: 'FAILED', error: msg });
        setProgress((prev) =>
          prev
            ? prev.map((p, idx) => (idx === i ? { ...p, status: 'fail', error: msg } : p))
            : prev
        );
      }
    }

    const status =
      failCount === 0 ? 'SUCCESS' : failCount === plans.length ? 'FAILED' : 'PARTIAL_SUCCESS';
    if (runId) {
      try {
        await apiFinishDataMigrate(runId, { status, results });
      } catch {
        /* history best-effort */
      }
    }

    setApplying(false);
    toast({
      tone: failCount === 0 ? 'success' : 'warning',
      title:
        failCount === 0
          ? `Migrated ${plans.length} row ops`
          : `Migrated with ${failCount} failure(s)`,
      body: `Destination: ${dest.label}. Snapshot + history saved.`,
      actionButtonLabel: 'View history',
      onAction: () => void openHistory(),
      durationMs: 8_000,
    });
    await onAfterMigrate?.();
  };

  if (!canCompareReady(source, dest)) return null;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-2"
      data-testid={`sql-data-migrate-bar-${statementIndex}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-400">
        <span className="inline-flex items-center gap-1 text-sky-300">
          <ArrowRightLeft className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
          Data migrate
        </span>
        <span className="text-slate-500 truncate max-w-[18rem]" title={`${source.label} → ${dest.label}`}>
          {source.label} → {dest.label}
        </span>
        <span className="text-slate-500">
          {classification.inserts.length} insert · {classification.updates.length} update ·{' '}
          {classification.deletes.length} delete
          {selected.uncappedCount > DATA_MIGRATE_ROW_CAP
            ? ` · capped ${DATA_MIGRATE_ROW_CAP}`
            : ''}
        </span>
        <button
          type="button"
          data-testid={`sql-data-migrate-history-${statementIndex}`}
          onClick={() => void openHistory()}
          className="inline-flex items-center gap-1 text-slate-500 hover:text-cyan-400"
        >
          <History className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} /> History
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
        <span className="text-slate-500">Keys</span>
        {source.columns.map((c) => (
          <label key={c} className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={keyNames.some((k) => k.toLowerCase() === c.toLowerCase())}
              onChange={() => toggleKey(c)}
              className="rounded border-slate-600"
            />
            <span className="font-mono">{c}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
        <label className="inline-flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-insert-${statementIndex}`}
            checked={doInsert}
            onChange={(e) => setDoInsert(e.target.checked)}
            className="rounded border-slate-600"
          />
          Insert ({classification.inserts.length})
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-update-${statementIndex}`}
            checked={doUpdate}
            onChange={(e) => setDoUpdate(e.target.checked)}
            className="rounded border-slate-600"
          />
          Update ({classification.updates.length})
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid={`sql-data-migrate-delete-${statementIndex}`}
            checked={doDelete}
            onChange={(e) => setDoDelete(e.target.checked)}
            className="rounded border-slate-600"
          />
          Delete ({classification.deletes.length})
        </label>
        <label
          className="inline-flex items-center gap-1 cursor-pointer select-none"
          title="When on, INSERT includes identity/autoincrement values from the source (preserve IDs). When off, the destination generates them."
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
        <button
          type="button"
          data-testid={`sql-data-migrate-apply-${statementIndex}`}
          disabled={
            applying ||
            !canDml ||
            selected.uncappedCount === 0 ||
            selected.uncappedCount > DATA_MIGRATE_ROW_CAP
          }
          onClick={() => void apply()}
          className="ml-auto px-2 py-0.5 rounded bg-cyan-700/40 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-600/50 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            selected.uncappedCount > DATA_MIGRATE_ROW_CAP
              ? `Over ${DATA_MIGRATE_ROW_CAP} ops — use Server Beam`
              : undefined
          }
        >
          {applying ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" strokeWidth={SQL_ICON_STROKE} /> Migrating…
            </span>
          ) : selected.uncappedCount > DATA_MIGRATE_ROW_CAP ? (
            `Over ${DATA_MIGRATE_ROW_CAP} — Server Beam`
          ) : (
            `Migrate ${selected.uncappedCount} ops`
          )}
        </button>
      </div>

      {!editTarget.ok && (
        <p className="text-[10px] text-amber-400/90">
          Migrate needs a single-table SELECT with schema loaded on the destination.
        </p>
      )}

      {progress &&
        createPortal(
          <div
            className="fixed bottom-4 right-4 z-[360] w-[22rem] max-h-[50vh] overflow-auto rounded-lg border border-slate-700 bg-slate-950 shadow-xl"
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
                <li key={`${p.op}-${p.keyLabel}-${i}`} className="flex items-center gap-2">
                  <span
                    className={
                      p.status === 'ok'
                        ? 'text-emerald-400'
                        : p.status === 'fail'
                          ? 'text-rose-400'
                          : p.status === 'running'
                            ? 'text-cyan-400'
                            : 'text-slate-500'
                    }
                  >
                    {p.status === 'running' ? '…' : p.status === 'ok' ? '✓' : p.status === 'fail' ? '✗' : '·'}
                  </span>
                  <span className="text-slate-400 uppercase w-12 shrink-0">{p.op}</span>
                  <span className="text-slate-300 truncate" title={p.error}>
                    {p.keyLabel}
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
