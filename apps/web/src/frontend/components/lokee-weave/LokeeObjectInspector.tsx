/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inspector for a Lokee graph node: columns with type/constraint subtitles,
 * a GitHub-style CREATE script diff, growth, and revert-to-version.
 * Indexes are stored but not a first-class inspector surface.
 */
import React, { useEffect, useState } from 'react';
import { isLokeeTableLikeType, lokeeColumnChangeSubtitle, lokeeTypeLabel } from '@foxschema/sql';
import { Loader2, RotateCcw, X } from 'lucide-react';
import {
  executeLokeeRevert,
  inspectLokeeObject,
  planLokeeRevert,
  type LokeeHistoryEvent,
  type LokeeInspectResult,
  type LokeeRevertPlan,
  type LokeeStoredObject,
} from '../../api/lokeeApi';
import { getSessionPassword } from '../../lib/sessionPasswords';
import { objectStyle, riskStyle } from '../../lib/lokeeColors';
import { toast } from '../../store/toastStore';
import { shortHash, type SchemaObjectNodeData } from './graphTypes';
import { GithubScriptDiff } from './GithubScriptDiff';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeObjectInspectorProps {
  databaseId: string;
  selected: SchemaObjectNodeData;
  onClose: () => void;
  captureConnectionId?: string;
  onSelectVersion?: (versionId: string) => void;
  onReverted?: () => void;
}

interface RevertUi {
  versionId: string;
  plan: LokeeRevertPlan | null;
  busy: boolean;
  error: string | null;
  confirmLossy: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function typeLabel(body: Record<string, unknown> | undefined): string {
  return lokeeTypeLabel(body);
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function ChildTable({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: LokeeStoredObject[];
  testId: string;
}): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <section data-testid={testId} className="flex flex-col gap-1">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li
            key={row.key}
            className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{row.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{shortHash(row.hash)}</span>
            </div>
            {row.type === 'column' && (
              <div className="text-[10px] text-slate-400">{lokeeColumnChangeSubtitle(row.body, undefined)}</div>
            )}
            {row.type === 'trigger' && (
              <div className="text-[10px] text-slate-400">
                {[asString(row.body.timing), asString(row.body.event)].filter(Boolean).join(' ')}
                {row.lineCount ? ` · ${row.lineCount} lines` : ''}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function pkNames(blueprint: LokeeInspectResult['blueprint']): Set<string> {
  const cols = blueprint.primaryKey?.body.columns;
  if (!Array.isArray(cols)) return new Set();
  return new Set(cols.filter((c): c is string => typeof c === 'string').map((c) => c.toUpperCase()));
}

function ColumnUpdates({
  columns,
  mutations,
  selectedVersionId,
  primaryKeys,
}: {
  columns: LokeeStoredObject[];
  mutations: LokeeInspectResult['columnMutations'];
  selectedVersionId: string;
  primaryKeys: Set<string>;
}): React.ReactElement | null {
  const byKey = new Map(mutations.map((m) => [m.objectKey, m]));
  const byName = new Map(mutations.map((m) => [m.columnName.toUpperCase(), m]));
  const liveKeys = new Set(columns.map((c) => c.key));
  const dropped = mutations.filter((m) => {
    if (liveKeys.has(m.objectKey)) return false;
    return m.events.at(-1)?.operation === 'DELETE';
  });
  if (columns.length === 0 && dropped.length === 0) return null;
  return (
    <section data-testid="lokee-inspector-columns" className="flex flex-col gap-1">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Columns</h3>
      <ul className="flex flex-col gap-0.5">
        {columns.map((column) => {
          const mutation = byKey.get(column.key) ?? byName.get(column.name.toUpperCase());
          const atThis = mutation?.events.filter((e) => e.versionId === selectedVersionId).at(-1);
          const previous = atThis?.previousBody;
          const pk = primaryKeys.has(column.name.toUpperCase());
          const subtitle = lokeeColumnChangeSubtitle(column.body, previous, { primaryKey: pk });
          return (
            <li
              key={column.key}
              className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{column.name}</span>
                {atThis && (
                  <span
                    className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide ${
                      atThis.operation === 'ADD'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : atThis.operation === 'DELETE'
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-amber-500/15 text-amber-200'
                    }`}
                  >
                    {atThis.operation}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-400">{subtitle}</div>
            </li>
          );
        })}
        {dropped.map((col) => {
          const last = col.events.at(-1);
          return (
            <li
              key={col.objectKey}
              className="rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-200"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium line-through">{col.columnName}</span>
                <span className="shrink-0 rounded bg-rose-500/15 px-1 text-[9px] font-bold uppercase tracking-wide text-rose-300">
                  DELETE
                </span>
              </div>
              {last?.previousBody && (
                <div className="text-[10px] text-rose-300/80">{lokeeColumnChangeSubtitle(undefined, last.previousBody)}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HistoryEvent({ point }: { point: LokeeHistoryEvent }): React.ReactElement {
  const typeChange =
    point.body?.dataType != null
      ? point.previousBody?.dataType
        ? `${typeLabel(point.previousBody)} → ${typeLabel(point.body)}`
        : typeLabel(point.body)
      : null;
  const lines =
    point.lineCount != null
      ? point.previousLineCount != null && point.previousLineCount !== point.lineCount
        ? `${point.previousLineCount} → ${point.lineCount} lines`
        : `${point.lineCount} lines`
      : null;
  return (
    <li className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2 text-slate-200">
        <span className="font-semibold">
          v{point.versionNumber} · {point.operation}
        </span>
        <span className="text-[10px] text-slate-500">{formatWhen(point.createdAt)}</span>
      </div>
      {typeChange && (
        <div className="mt-0.5 text-[10px] text-slate-400">
          {point.previousBody
            ? lokeeColumnChangeSubtitle(point.body, point.previousBody)
            : typeChange}
        </div>
      )}
      {lines && <div className="text-[10px] text-slate-400">{lines}</div>}
      {point.reused && (
        <div className="text-[10px] text-sky-400/80">Reused hash — stored once (pointer)</div>
      )}
    </li>
  );
}

function RevertCard({
  connectionId,
  revert,
  onConfirmLossy,
  onExecute,
  onCancel,
}: {
  connectionId?: string;
  revert: RevertUi;
  onConfirmLossy: (checked: boolean) => void;
  onExecute: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const plan = revert.plan;
  const blocked = plan?.reversal.risk === 'blocked';
  const lossy = plan?.reversal.risk === 'lossy';
  const canRun =
    Boolean(plan) &&
    !revert.busy &&
    !blocked &&
    Boolean(connectionId) &&
    (!lossy || revert.confirmLossy) &&
    !plan?.alreadyAtTarget;

  return (
    <section
      data-testid="lokee-inspector-revert-plan"
      className="rounded border border-amber-500/40 bg-amber-950/20 px-2 py-2"
    >
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-200">Revert schema</h3>
      {revert.busy && !plan && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={SQL_ICON_STROKE} />
          Planning reverse DDL…
        </div>
      )}
      {revert.error && <p className="mt-1 text-[11px] text-rose-300">{revert.error}</p>}
      {plan && (
        <>
          <p className="mt-1 text-[11px] text-slate-300">
            Apply reverse DDL so the live schema matches v{plan.toVersion.number}, then record a new
            version.
          </p>
          {plan.alreadyAtTarget ? (
            <p className="mt-1 text-[11px] text-slate-400">Already at this version.</p>
          ) : (
            <>
              <div
                className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  riskStyle(plan.reversal.risk).badge
                }`}
              >
                {riskStyle(plan.reversal.risk).label}
                {plan.reversal.lossyCount > 0 ? ` · ${plan.reversal.lossyCount} lossy` : ''}
                {plan.reversal.blockedCount > 0 ? ` · ${plan.reversal.blockedCount} blocked` : ''}
              </div>
              <ul className="mt-1 max-h-32 overflow-auto text-[10px] text-slate-400">
                {plan.reversal.verdicts.slice(0, 12).map((v) => (
                  <li key={v.key} className="py-0.5">
                    <span className="text-slate-300">{v.summary}</span>
                    {v.dataLoss ? ` — ${v.dataLoss}` : ''}
                  </li>
                ))}
              </ul>
              {plan.statements.length > 0 && (
                <pre className="mt-1 max-h-28 overflow-auto rounded border border-slate-800 bg-slate-950 p-1.5 font-mono text-[10px] leading-4 text-slate-400">
                  {plan.statements.join('\n')}
                </pre>
              )}
              {lossy && (
                <label className="mt-1.5 flex cursor-pointer items-start gap-1.5 text-[11px] text-amber-100">
                  <input
                    type="checkbox"
                    data-testid="lokee-revert-confirm-lossy"
                    checked={revert.confirmLossy}
                    onChange={(e) => onConfirmLossy(e.target.checked)}
                  />
                  I understand dropped columns and tables cannot be restored with their data.
                </label>
              )}
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  data-testid="lokee-revert-execute"
                  disabled={!canRun}
                  onClick={onExecute}
                  className="rounded border border-amber-500/40 bg-amber-950/60 px-2 py-1 text-[11px] font-semibold text-amber-50 disabled:opacity-40"
                >
                  {revert.busy ? 'Reverting…' : `Revert to v${plan.toVersion.number}`}
                </button>
                <button
                  type="button"
                  data-testid="lokee-revert-cancel"
                  onClick={onCancel}
                  className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                >
                  Cancel
                </button>
              </div>
              {!connectionId && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Pick a credential in History to apply the revert.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function LokeeObjectInspector({
  databaseId,
  selected,
  onClose,
  captureConnectionId,
  onSelectVersion,
  onReverted,
}: LokeeObjectInspectorProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LokeeInspectResult | null>(null);
  const [revert, setRevert] = useState<RevertUi | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevert(null);
    // Drop the previous object's payload: this component is not remounted when
    // the selection changes, so keeping it would render the old blueprint,
    // source, and growth under the new object's name until the fetch lands.
    setData(null);
    void inspectLokeeObject(databaseId, selected.versionId, selected.objectKey)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load object');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [databaseId, selected.versionId, selected.objectKey]);

  const focus = data?.blueprint.object ?? data?.blueprint.container;
  const source =
    focus?.sourceText ??
    (typeof focus?.body.definition === 'string' ? focus.body.definition : null);
  const script = (data?.script && data.script.length > 0 ? data.script : source) ?? '';
  const previousScript = data?.previousScript ?? '';
  const style = objectStyle(selected.objectType);
  const mutations = data?.columnMutations ?? [];
  const growthKind = data?.blueprint.container?.type ?? selected.objectType;
  const showGrowth = isLokeeTableLikeType(growthKind) && (data?.growth.length ?? 0) > 0;
  const headVersionId = data?.growth.at(-1)?.versionId ?? null;

  const openRevert = async (versionId: string) => {
    setRevert({ versionId, plan: null, busy: true, error: null, confirmLossy: false });
    try {
      const plan = await planLokeeRevert(databaseId, versionId);
      setRevert((prev) => (prev?.versionId === versionId ? { ...prev, plan, busy: false } : prev));
    } catch (err: unknown) {
      setRevert((prev) =>
        prev?.versionId === versionId
          ? { ...prev, busy: false, error: err instanceof Error ? err.message : 'Failed to plan revert' }
          : prev
      );
    }
  };

  const runRevert = async () => {
    if (!revert?.plan || !captureConnectionId) return;
    setRevert((prev) => (prev ? { ...prev, busy: true, error: null } : prev));
    try {
      const result = await executeLokeeRevert(databaseId, {
        toVersionId: revert.versionId,
        connectionId: captureConnectionId,
        password: getSessionPassword(captureConnectionId) || undefined,
        confirmLossy: revert.plan.reversal.risk === 'lossy' ? revert.confirmLossy : undefined,
      });
      toast({
        tone: 'success',
        title: result.alreadyAtTarget
          ? `Already at v${result.toVersion.number}`
          : `Reverted to v${result.toVersion.number}`,
        body: result.capture?.changed
          ? `Recorded v${result.capture.versionNumber} · ${result.capture.changeCount} object change(s)`
          : 'Live schema matches that version.',
      });
      setRevert(null);
      onReverted?.();
    } catch (err: unknown) {
      setRevert((prev) =>
        prev ? { ...prev, busy: false, error: err instanceof Error ? err.message : 'Revert failed' } : prev
      );
    }
  };

  return (
    <aside
      data-testid="lokee-object-inspector"
      // The panel's load state, declared rather than inferred. Without it the
      // only way to tell "still fetching" from "ready" is to string-match the
      // "Loading blueprint…" copy, which couples tests to user-facing wording.
      // `data-object-key` comes from the payload, not from `selected`, so it
      // changes only once *this* object's fetch has landed — `selected.name`
      // updates synchronously on click and proves nothing about the fetch.
      data-state={loading ? 'loading' : error ? 'error' : data ? 'ready' : 'empty'}
      data-object-key={focus?.key ?? undefined}
      className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-950/80"
    >
      <header className="flex items-start gap-2 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {style.label}
          </div>
          <div className="truncate text-sm font-semibold text-slate-100" title={selected.name}>
            {selected.name}
          </div>
          <div className="font-mono text-[10px] text-slate-500">{shortHash(selected.objectHash)}</div>
        </div>
        <button
          type="button"
          data-testid="lokee-inspector-close"
          onClick={onClose}
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          title="Close"
        >
          <X className="h-3.5 w-3.5" strokeWidth={SQL_ICON_STROKE} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} />
            Loading blueprint…
          </div>
        )}
        {error && <div className="text-xs text-rose-300">{error}</div>}
        {data && (
          <>
            {(data.blueprint.columns.length > 0 ||
              data.blueprint.foreignKeys.length > 0 ||
              data.blueprint.triggers.length > 0 ||
              data.blueprint.primaryKey) && (
              <div className="flex flex-col gap-2" data-testid="lokee-inspector-blueprint">
                <ColumnUpdates
                  columns={data.blueprint.columns}
                  mutations={mutations}
                  selectedVersionId={selected.versionId}
                  primaryKeys={pkNames(data.blueprint)}
                />
                {data.blueprint.primaryKey && (
                  <section className="text-[11px] text-slate-300">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Primary key
                    </h3>
                    <div className="mt-0.5">
                      {Array.isArray(data.blueprint.primaryKey.body.columns)
                        ? (data.blueprint.primaryKey.body.columns as string[]).join(', ')
                        : '—'}
                    </div>
                  </section>
                )}
                <ChildTable
                  title="Foreign keys"
                  rows={data.blueprint.foreignKeys}
                  testId="lokee-inspector-fks"
                />
                <ChildTable title="Triggers" rows={data.blueprint.triggers} testId="lokee-inspector-triggers" />
              </div>
            )}

            {script && (
              <section data-testid="lokee-inspector-source">
                <GithubScriptDiff original={previousScript} modified={script} />
              </section>
            )}

            {showGrowth && (
              <section data-testid="lokee-inspector-growth">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Table growth · v{data.growth[0]?.versionNumber}…v
                  {data.growth[data.growth.length - 1]?.versionNumber}
                </h3>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {data.growth.map((g) => {
                    const isHead = g.versionId === headVersionId;
                    const isSelected = g.versionId === selected.versionId;
                    return (
                      <li
                        key={g.versionId}
                        className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] ${
                          isSelected ? 'bg-slate-800/80 text-slate-100' : 'text-slate-300'
                        }`}
                      >
                        <button
                          type="button"
                          data-testid={`lokee-inspector-version-${g.versionNumber}`}
                          onClick={() => onSelectVersion?.(g.versionId)}
                          className="min-w-0 flex-1 text-left hover:text-cyan-200"
                          title={`Show this object at v${g.versionNumber}`}
                        >
                          <span className="font-semibold text-slate-200">v{g.versionNumber}</span>
                          {isHead && (
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-cyan-400">
                              head
                            </span>
                          )}
                          <span className="ml-2 text-slate-400">
                            {g.columns} cols
                            {g.triggers > 0 ? ` · ${g.triggers} trg` : ''}
                          </span>
                        </button>
                        {!isHead && (
                          <button
                            type="button"
                            data-testid={`lokee-inspector-revert-${g.versionNumber}`}
                            onClick={() => void openRevert(g.versionId)}
                            className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-950/50"
                            title={`Revert live schema to v${g.versionNumber}`}
                          >
                            <RotateCcw className="h-3 w-3" strokeWidth={SQL_ICON_STROKE} />
                            Revert
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section data-testid="lokee-inspector-history">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Change timeline
              </h3>
              {mutations.length > 0 ? (
                <div data-testid="lokee-inspector-column-mutations" className="mt-1 flex flex-col gap-2">
                  {mutations.map((col) => (
                    <div key={col.objectKey} className="rounded border border-slate-800 px-2 py-1.5">
                      <div className="text-[11px] font-semibold text-slate-200">{col.columnName}</div>
                      <ol className="mt-1 flex flex-col gap-1">
                        {col.events.map((point) => (
                          <HistoryEvent key={`${point.versionId}:${point.operation}`} point={point} />
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              ) : data.history.length === 0 ? (
                <p className="mt-1 text-[11px] text-slate-500">No recorded changes for this object.</p>
              ) : (
                <ol className="mt-1 flex flex-col gap-1.5">
                  {data.history.map((point) => (
                    <HistoryEvent key={`${point.versionId}:${point.operation}`} point={point} />
                  ))}
                </ol>
              )}
            </section>

            {revert && (
              <RevertCard
                connectionId={captureConnectionId}
                revert={revert}
                onConfirmLossy={(checked) =>
                  setRevert((prev) => (prev ? { ...prev, confirmLossy: checked } : prev))
                }
                onExecute={() => void runRevert()}
                onCancel={() => setRevert(null)}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
