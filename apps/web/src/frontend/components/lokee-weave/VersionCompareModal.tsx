/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * "What did this version change?" — a Compare-Schema-shaped diff between a
 * version and the one before it.
 *
 * Served entirely from the object store, so it opens on a database that is
 * offline, moved, or decommissioned. That is the difference from Compare
 * Schema proper, which needs two reachable databases.
 *
 * Grouped by container and collapsed by default: a migration that touches
 * forty columns across three tables is three rows to scan, not forty.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';
import type { TableDiff } from '@foxschema/sql';
import {
  compareLokeeVersions,
  executeLokeeRevert,
  planLokeeRevert,
  LokeeRevertError,
  type LokeeRevertPlan,
  type VersionCompare,
} from '../../api/lokeeApi';
import { getSessionPassword } from '../../lib/sessionPasswords';
import { toast } from '../../store/toastStore';
import { riskStyle } from '../../lib/lokeeColors';
import { SchemaBlueprint } from '../SchemaBlueprint';
import { SchemaDiffTree, orderTablesForDisplay } from '../SchemaDiffTree';
import { DetailTabs, type DetailTab } from '../DetailTabs';
import { buildTableDdlDiffLines, DdlDiffLines } from '../SchemaDdlDiff';
import { GithubScriptDiff } from './GithubScriptDiff';
import { versionDisplayName } from './graphTypes';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

/**
 * The pane ids are Compare Schema's own — see `DetailTabs`. History used to
 * name them differently, which is how one flow came to look like two.
 */
export type ComparePaneTab = DetailTab;

export interface VersionCompareModalProps {
  databaseId: string;
  /** Connection used to run a revert. Without it, Execute is read-only. */
  captureConnectionId?: string;
  /** Called after a successful revert so the caller can reload the graph. */
  onReverted?: () => void;
  /** The reference side — "Original server" in the bar. */
  versionId: string;
  /**
   * The side that would change — "Target" in the bar. Omit to use the
   * reference's own parent, which is the "what did this version do?" reading.
   */
  againstVersionId?: string;
  onClose: () => void;
}


/**
 * Header for the selected object. The tables underneath are `SchemaBlueprint`,
 * the very component Compare Schema renders — history showed a thinner,
 * hand-written list before, which is how the two views drifted apart.
 */
function ObjectDetail({ diff }: { diff: TableDiff }): React.ReactElement {
  return (
    <div data-testid="lokee-cmp-detail" className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-2 py-1.5">
        <div className="truncate text-[12px] font-semibold text-slate-100">{diff.tableName}</div>
        <div className="text-[10px] text-slate-500">
          {diff.objectType} · {diff.status}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <SchemaBlueprint diff={diff} density="compact" />
      </div>
    </div>
  );
}

export function VersionCompareModal({
  databaseId,
  captureConnectionId,
  onReverted,
  versionId,
  againstVersionId,
  onClose,
}: VersionCompareModalProps): React.ReactElement {
  const [tab, setTab] = useState<ComparePaneTab>('DIFF');
  const [plan, setPlan] = useState<LokeeRevertPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirmLossy, setConfirmLossy] = useState(false);
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<VersionCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void compareLokeeVersions(databaseId, versionId, againstVersionId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to compare versions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [databaseId, versionId, againstVersionId]);

  // Escape closes, which is what every other dialog in the app does.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose]
  );

  const [selectedName, setSelectedName] = useState<string | null>(null);
  // Which objects the user has ticked to revert. Empty means "none selected",
  // which the backend deliberately treats as a no-op rather than "everything".
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const toggleSelection = useCallback((name: string) => {
    setSelection((s) => ({ ...s, [name]: !s[name] }));
  }, []);

  // Unchanged objects are the overwhelming majority of any real schema and are
  // not what the reader opened this for.
  const changed = useMemo(
    () => (data?.compare.tables ?? []).filter((t) => t.status !== 'UNCHANGED'),
    [data]
  );

  // Default the detail pane to the first changed object rather than showing an
  // empty pane next to a populated tree.
  const selectedDiff = useMemo(() => {
    const named = changed.find((t) => t.tableName === selectedName);
    if (named) return named;
    // Display order, not array order — the tree groups by type, so `changed[0]`
    // is usually not the row sitting at the top of the list.
    return orderTablesForDisplay(changed)[0] ?? null;
  }, [changed, selectedName]);

  // Object keys for the ticked rows. The tree ticks by table name, so map them
  // back to container keys the backend understands.
  const selectedKeys = useMemo(() => {
    const names = Object.entries(selection)
      .filter(([, on]) => on)
      .map(([name]) => name);
    return names.map((n) => {
      const t = changed.find((x) => x.tableName === n);
      const kind = (t?.objectType ?? 'TABLE').toLowerCase();
      return `${kind}:${n.toUpperCase()}`;
    });
  }, [selection, changed]);

  // "Make Target match Original" is exactly a revert of Target to Original.
  // Planned whenever the dialog has data — the run button lives in the toolbar
  // now, so it must know the statement count on every tab.
  const loadPlan = useCallback(async () => {
    setPlanning(true);
    setPlanError(null);
    try {
      setPlan(
        await planLokeeRevert(
          databaseId,
          versionId,
          selectedKeys.length > 0 ? selectedKeys : undefined
        )
      );
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Failed to plan');
    } finally {
      setPlanning(false);
    }
  }, [databaseId, versionId, selectedKeys]);

  useEffect(() => {
    if (data) void loadPlan();
  }, [data, loadPlan]);

  const runRevert = useCallback(async () => {
    if (!captureConnectionId || !plan) return;
    setRunning(true);
    try {
      await executeLokeeRevert(databaseId, {
        toVersionId: versionId,
        connectionId: captureConnectionId,
        password: getSessionPassword(captureConnectionId),
        confirmLossy,
        objectKeys: selectedKeys.length > 0 ? selectedKeys : undefined,
      });
      toast({
        tone: 'success',
        title: 'Revert applied',
        body: 'The schema was reverted and recorded as a new version.',
      });
      onReverted?.();
      onClose();
    } catch (err) {
      const message =
        err instanceof LokeeRevertError ? err.message : err instanceof Error ? err.message : 'Revert failed';
      toast({ tone: 'warning', title: 'Revert failed', body: message });
    } finally {
      setRunning(false);
    }
  }, [
    captureConnectionId,
    plan,
    databaseId,
    versionId,
    confirmLossy,
    selectedKeys,
    onReverted,
    onClose,
  ]);

  // The workspace's builder, fed by a stored version instead of a connection.
  // Both sides are the same dialect here — this is one database over time.
  const ddlLines = useMemo(() => {
    if (!selectedDiff || selectedDiff.objectType !== 'TABLE') return [];
    const dialect = data?.dialect ?? '';
    return buildTableDdlDiffLines(selectedDiff, dialect, dialect, (ddl) => ddl);
  }, [selectedDiff, data]);

  const heading = useMemo(() => {
    if (!data) return 'Compare versions';
    const reference = versionDisplayName({ number: data.to.number, name: data.to.name });
    if (!data.from) return `${reference} · first capture`;
    const other = versionDisplayName({ number: data.from.number, name: data.from.name });
    // Two entry points ask different questions, so the heading has to say which.
    //
    //   version node click → "what did this version do?"  → parent → version
    //   the Original/Target bar → "what would make Target match Original?"
    //
    // Naming the roles rather than relying on the arrow alone keeps the heading
    // from contradicting the bar, which it did when both used a bare arrow.
    return againstVersionId
      ? `Original ${reference} → Target ${other}`
      : `${other} → ${reference}`;
  }, [data, againstVersionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Compare versions"
      data-testid="lokee-version-compare"
      data-state={loading ? 'loading' : error ? 'error' : data ? 'ready' : 'empty'}
      onKeyDown={onKeyDown}
    >
      <div className="flex max-h-full w-[1200px] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-xl">
        <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Schema compare
            </div>
            <div className="truncate text-sm font-semibold text-slate-100">{heading}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="lokee-version-compare-close"
            aria-label="Close compare"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" strokeWidth={SQL_ICON_STROKE} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-3">
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} />
              Comparing versions…
            </div>
          )}
          {error && <p className="text-[12px] text-rose-300">{error}</p>}

          {data && !loading && (
            <>
              <div
                data-testid="lokee-cmp-summary"
                className="mb-2 flex flex-wrap gap-2 text-[11px]"
              >
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                  {data.compare.summary.added} added
                </span>
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">
                  {data.compare.summary.modified} modified
                </span>
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                  {data.compare.summary.removed} removed
                </span>
                <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-slate-400">
                  {data.compare.summary.unchanged} unchanged
                </span>
              </div>

              {changed.length === 0 ? (
                <p data-testid="lokee-cmp-identical" className="text-[12px] text-slate-400">
                  {data.from
                    ? 'Nothing changed between these versions — every object hashes the same.'
                    : 'This is the first capture, so there is no earlier version to compare against.'}
                </p>
              ) : (
                // The same tree the live Compare workspace renders. Selection is
                // the revert picker here and the deploy picker there — one
                // gesture, one component.
                <div className="flex gap-2" style={{ minHeight: 380 }}>
                  <div className="w-[300px] shrink-0 overflow-auto pr-1">
                    <SchemaDiffTree
                      tables={changed}
                      selectedName={selectedDiff?.tableName ?? null}
                      onSelect={(t) => setSelectedName(t.tableName)}
                      selection={selection}
                      onToggleSelection={toggleSelection}
                      selectionTitle="Include this object when reverting to the earlier version"
                      emptyMessage="No changed objects in this version."
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-slate-800">
                    {/* The workspace's own toolbar: the same three tabs, and
                        the run button top-right. Compare Schema calls it
                        "Execute Sync Script"; here the script is a revert. */}
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 p-1">
                      <DetailTabs
                        active={tab}
                        onSelect={setTab}
                        testIdPrefix="lokee-cmp"
                        size="compact"
                      />
                      <button
                        type="button"
                        data-testid="lokee-cmp-run-revert"
                        title={
                          captureConnectionId
                            ? `Apply ${plan?.statements.length ?? 0} statement(s) and record a new version`
                            : 'Choose a credential in the bar above to run this'
                        }
                        disabled={
                          running ||
                          !captureConnectionId ||
                          !plan ||
                          plan.reversal.risk === 'blocked' ||
                          plan.alreadyAtTarget ||
                          plan.statements.length === 0 ||
                          (plan.reversal.risk === 'lossy' && !confirmLossy)
                        }
                        onClick={() => void runRevert()}
                        className="flex shrink-0 items-center gap-1.5 rounded border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 text-[11px] font-bold text-amber-100 transition hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Play className="h-3 w-3 fill-current" strokeWidth={SQL_ICON_STROKE} />
                        {running ? 'Applying…' : `Execute migration (${plan?.statements.length ?? 0})`}
                      </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto">
                      {tab === 'DIFF' &&
                        (selectedDiff ? (
                          <ObjectDetail diff={selectedDiff} />
                        ) : (
                          <p className="p-3 text-[11px] text-slate-500">
                            Select an object to see what changed inside it.
                          </p>
                        ))}

                      {/* Not a second DDL renderer: `buildTableDdlDiffLines` is
                          the workspace's, and a stored version supplies the same
                          TableDiff a live connection does. Non-tables are
                          replaced wholesale, so they read as a script diff. */}
                      {tab === 'DDL_DIFF' && (
                        <div data-testid="lokee-cmp-ddl-diff" className="p-1">
                          {!selectedDiff ? (
                            <p className="p-2 text-[11px] text-slate-500">
                              Select an object to see its DDL.
                            </p>
                          ) : selectedDiff.objectType === 'TABLE' ? (
                            <DdlDiffLines lines={ddlLines} />
                          ) : (
                            <GithubScriptDiff
                              original={selectedDiff.targetTable?.definition ?? ''}
                              modified={selectedDiff.sourceTable?.definition ?? ''}
                            />
                          )}
                        </div>
                      )}

                      {tab === 'SQL' && (
                        <div data-testid="lokee-cmp-ddl" className="flex flex-col gap-2 p-2">
                          {planning && <p className="text-[11px] text-slate-400">Planning…</p>}
                          {planError && <p className="text-[11px] text-rose-300">{planError}</p>}
                          {plan && (
                            <>
                              <div
                                className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  riskStyle(plan.reversal.risk).badge
                                }`}
                              >
                                {riskStyle(plan.reversal.risk).label}
                                {plan.reversal.lossyCount > 0
                                  ? ` · ${plan.reversal.lossyCount} lossy`
                                  : ''}
                                {plan.reversal.blockedCount > 0
                                  ? ` · ${plan.reversal.blockedCount} blocked`
                                  : ''}
                              </div>
                              <p className="text-[11px] text-slate-300">
                                Applies {plan.statements.length}{' '}
                                {plan.statements.length === 1 ? 'statement' : 'statements'} so the
                                live schema matches{' '}
                                {versionDisplayName({
                                  number: plan.toVersion.number,
                                  name: plan.toVersion.name,
                                })}
                                , then records the result as a new version.
                              </p>
                              {selectedKeys.length > 0 && (
                                <p className="text-[10px] text-cyan-300">
                                  Scoped to {selectedKeys.length} selected{' '}
                                  {selectedKeys.length === 1 ? 'object' : 'objects'}.
                                </p>
                              )}
                              {plan.reversal.risk === 'lossy' && (
                                <label className="flex items-start gap-1.5 text-[11px] text-amber-200">
                                  <input
                                    type="checkbox"
                                    data-testid="lokee-cmp-confirm-lossy"
                                    checked={confirmLossy}
                                    onChange={(e) => setConfirmLossy(e.target.checked)}
                                    className="mt-0.5 h-3 w-3 accent-amber-500"
                                  />
                                  I understand data will be lost permanently.
                                </label>
                              )}
                              {plan.reversal.risk === 'blocked' && (
                                <p className="text-[11px] text-rose-300">
                                  Blocked — this cannot be applied without losing data the schema
                                  cannot restore.
                                </p>
                              )}
                              {!captureConnectionId && (
                                <p className="text-[11px] text-slate-500">
                                  Choose a credential in the bar above to run this.
                                </p>
                              )}
                              {plan.statements.length === 0 && !planning ? (
                                <p className="text-[11px] text-slate-500">
                                  Nothing to apply — Target already matches Original
                                  {selectedKeys.length > 0 ? ' for the selected objects' : ''}.
                                </p>
                              ) : (
                                <pre className="whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] leading-relaxed text-slate-300">
                                  {/* Statements may already be terminated; joining
                                      with ';' unconditionally produced `…;;`. */}
                                  {plan.statements
                                    .map((st) => (st.trimEnd().endsWith(';') ? st : `${st};`))
                                    .join('\n\n')}
                                </pre>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
