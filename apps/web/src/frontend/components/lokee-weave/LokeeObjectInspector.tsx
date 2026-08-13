/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only inspector for a Lokee graph node: table blueprint, column
 * mutations across v1…vN, growth, and revert-to-version.
 */
import React, { useEffect, useState } from 'react';
import { parseTypeText } from '@foxschema/sql';
import { Loader2, RotateCcw, X } from 'lucide-react';
import {
  executeLokeeRevert,
  inspectLokeeObject,
  LokeeRevertError,
  planLokeeRevert,
  type LokeeInspectResult,
  type LokeeRevertPlan,
  type LokeeStoredObject,
} from '../../api/lokeeApi';
import { getSessionPassword } from '../../lib/sessionPasswords';
import { objectStyle, OPERATION_GLYPH, riskStyle } from '../../lib/lokeeColors';
import { toast } from '../../store/toastStore';
import { shortHash, type SchemaObjectNodeData } from './graphTypes';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeObjectInspectorProps {
  databaseId: string;
  selected: SchemaObjectNodeData;
  onClose: () => void;
  /** Saved credential used to apply reverse DDL. */
  captureConnectionId?: string;
  /** Jump the inspector to the same object at another version. */
  onSelectVersion?: (versionId: string) => void;
  /** After a successful revert, reload the graph. */
  onReverted?: () => void;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function typeLabel(body: Record<string, unknown> | undefined): string {
  const raw = asString(body?.dataType) ?? asString(body?.type);
  if (!raw) return '—';
  const parsed = parseTypeText(raw);
  if (!parsed) return raw;
  if (parsed.length != null) return `${parsed.base}(${parsed.length})`;
  if (parsed.precision != null) {
    return parsed.scale != null
      ? `${parsed.base}(${parsed.precision},${parsed.scale})`
      : `${parsed.base}(${parsed.precision})`;
  }
  return parsed.base;
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
              <div className="text-[10px] text-slate-400">
                {typeLabel(row.body)}
                {row.body.nullable === false ? ' · not null' : ''}
              </div>
            )}
            {row.type === 'index' && (
              <div className="text-[10px] text-slate-400">
                {Array.isArray(row.body.columns) ? (row.body.columns as string[]).join(', ') : ''}
                {row.body.unique ? ' · unique' : ''}
              </div>
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

function HistoryEvent({
  point,
}: {
  point: LokeeInspectResult['history'][number];
}): React.ReactElement {
  const glyph = OPERATION_GLYPH[point.operation] ?? point.operation;
  return (
    <li className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2 text-slate-200">
        <span className="font-semibold">
          v{point.versionNumber} · {glyph} {point.operation}
        </span>
        <span className="text-[10px] text-slate-500">{formatWhen(point.createdAt)}</span>
      </div>
      {point.body?.dataType != null && (
        <div className="mt-0.5 text-[10px] text-slate-400">
          {point.previousBody?.dataType
            ? `${typeLabel(point.previousBody)} → ${typeLabel(point.body)}`
            : typeLabel(point.body)}
        </div>
      )}
      {point.lineCount != null && (
        <div className="text-[10px] text-slate-400">
          {point.previousLineCount != null && point.previousLineCount !== point.lineCount
            ? `${point.previousLineCount} → ${point.lineCount} lines`
            : `${point.lineCount} lines`}
        </div>
      )}
      {point.reused && (
        <div className="text-[10px] text-sky-400/80">Reused hash — stored once (pointer)</div>
      )}
    </li>
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
  const [revertFor, setRevertFor] = useState<string | null>(null);
  const [revertPlan, setRevertPlan] = useState<LokeeRevertPlan | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [confirmLossy, setConfirmLossy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  useEffect(() => {
    setRevertFor(null);
    setRevertPlan(null);
    setRevertError(null);
    setConfirmLossy(false);
  }, [selected.versionId, selected.objectKey]);

  const focus = data?.blueprint.object ?? data?.blueprint.container;
  const source =
    focus?.sourceText ??
    (typeof focus?.body.definition === 'string' ? focus.body.definition : null);
  const style = objectStyle(selected.objectType);
  const headVersionId = data?.headVersionId ?? null;
  const mutations = data?.columnMutations ?? [];

  const openRevert = async (versionId: string) => {
    setRevertFor(versionId);
    setRevertPlan(null);
    setRevertError(null);
    setConfirmLossy(false);
    setRevertBusy(true);
    try {
      const plan = await planLokeeRevert(databaseId, versionId);
      setRevertPlan(plan);
    } catch (err: unknown) {
      setRevertError(err instanceof Error ? err.message : 'Failed to plan revert');
    } finally {
      setRevertBusy(false);
    }
  };

  const runRevert = async () => {
    if (!revertFor || !captureConnectionId || !revertPlan) return;
    if (revertPlan.reversal.risk === 'blocked') return;
    setRevertBusy(true);
    setRevertError(null);
    try {
      const result = await executeLokeeRevert(databaseId, {
        toVersionId: revertFor,
        connectionId: captureConnectionId,
        password: getSessionPassword(captureConnectionId) || undefined,
        confirmLossy: revertPlan.reversal.risk === 'lossy' ? confirmLossy : undefined,
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
      setRevertFor(null);
      setRevertPlan(null);
      onReverted?.();
    } catch (err: unknown) {
      if (err instanceof LokeeRevertError && err.code === 'confirm_lossy' && err.plan) {
        setRevertPlan(err.plan);
        setRevertError('This revert destroys data. Confirm below to continue.');
      } else {
        setRevertError(err instanceof Error ? err.message : 'Revert failed');
      }
    } finally {
      setRevertBusy(false);
    }
  };

  return (
    <aside
      data-testid="lokee-object-inspector"
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
              data.blueprint.indexes.length > 0 ||
              data.blueprint.triggers.length > 0) && (
              <div className="flex flex-col gap-2" data-testid="lokee-inspector-blueprint">
                <ChildTable title="Columns" rows={data.blueprint.columns} testId="lokee-inspector-columns" />
                <ChildTable title="Indexes" rows={data.blueprint.indexes} testId="lokee-inspector-indexes" />
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

            {source && (
              <section data-testid="lokee-inspector-source">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Source
                  {focus?.lineCount ? ` · ${focus.lineCount} lines` : ''}
                </h3>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] leading-4 text-slate-300">
                  {source}
                </pre>
              </section>
            )}

            {data.growth.length > 0 && (
              <section data-testid="lokee-inspector-growth">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Table growth · v1…v{data.growth[data.growth.length - 1]?.versionNumber}
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
                          {isHead ? (
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-cyan-400">
                              head
                            </span>
                          ) : null}
                          <span className="ml-2 text-slate-400">
                            {g.columns} cols · {g.indexes} idx · {g.triggers} trg
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

            {mutations.length > 0 && (
              <section data-testid="lokee-inspector-column-mutations">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Column mutations
                </h3>
                <div className="mt-1 flex flex-col gap-2">
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
              </section>
            )}

            <section data-testid="lokee-inspector-history">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Change timeline
              </h3>
              {data.history.length === 0 ? (
                <p className="mt-1 text-[11px] text-slate-500">No recorded changes for this object.</p>
              ) : (
                <ol className="mt-1 flex flex-col gap-1.5">
                  {data.history.map((point) => (
                    <HistoryEvent key={`${point.versionId}:${point.operation}`} point={point} />
                  ))}
                </ol>
              )}
            </section>

            {revertFor && (
              <section
                data-testid="lokee-inspector-revert-plan"
                className="rounded border border-amber-500/40 bg-amber-950/20 px-2 py-2"
              >
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  Revert schema
                </h3>
                {revertBusy && !revertPlan && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={SQL_ICON_STROKE} />
                    Planning reverse DDL…
                  </div>
                )}
                {revertError && <p className="mt-1 text-[11px] text-rose-300">{revertError}</p>}
                {revertPlan && (
                  <>
                    <p className="mt-1 text-[11px] text-slate-300">
                      Live schema is v{revertPlan.fromVersion.number}. Revert applies reverse DDL so
                      it matches v{revertPlan.toVersion.number}, then records a new version.
                    </p>
                    {revertPlan.alreadyAtTarget ? (
                      <p className="mt-1 text-[11px] text-slate-400">Already at this version.</p>
                    ) : (
                      <>
                        <div
                          className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            riskStyle(revertPlan.reversal.risk).badge
                          }`}
                        >
                          {riskStyle(revertPlan.reversal.risk).label}
                          {revertPlan.reversal.lossyCount > 0
                            ? ` · ${revertPlan.reversal.lossyCount} lossy`
                            : ''}
                          {revertPlan.reversal.blockedCount > 0
                            ? ` · ${revertPlan.reversal.blockedCount} blocked`
                            : ''}
                        </div>
                        <ul className="mt-1 max-h-32 overflow-auto text-[10px] text-slate-400">
                          {revertPlan.reversal.verdicts.slice(0, 12).map((v) => (
                            <li key={v.key} className="py-0.5">
                              <span className="text-slate-300">{v.summary}</span>
                              {v.dataLoss ? ` — ${v.dataLoss}` : ''}
                            </li>
                          ))}
                        </ul>
                        {revertPlan.statements.length > 0 && (
                          <pre className="mt-1 max-h-28 overflow-auto rounded border border-slate-800 bg-slate-950 p-1.5 font-mono text-[10px] leading-4 text-slate-400">
                            {revertPlan.statements.join('\n')}
                          </pre>
                        )}
                        {revertPlan.reversal.risk === 'lossy' && (
                          <label className="mt-1.5 flex cursor-pointer items-start gap-1.5 text-[11px] text-amber-100">
                            <input
                              type="checkbox"
                              data-testid="lokee-revert-confirm-lossy"
                              checked={confirmLossy}
                              onChange={(e) => setConfirmLossy(e.target.checked)}
                            />
                            I understand dropped columns and tables cannot be restored with their
                            data.
                          </label>
                        )}
                        <div className="mt-2 flex gap-1">
                          <button
                            type="button"
                            data-testid="lokee-revert-execute"
                            disabled={
                              revertBusy ||
                              revertPlan.reversal.risk === 'blocked' ||
                              !captureConnectionId ||
                              (revertPlan.reversal.risk === 'lossy' && !confirmLossy)
                            }
                            onClick={() => void runRevert()}
                            className="rounded border border-amber-500/40 bg-amber-950/60 px-2 py-1 text-[11px] font-semibold text-amber-50 disabled:opacity-40"
                          >
                            {revertBusy ? 'Reverting…' : `Revert to v${revertPlan.toVersion.number}`}
                          </button>
                          <button
                            type="button"
                            data-testid="lokee-revert-cancel"
                            onClick={() => {
                              setRevertFor(null);
                              setRevertPlan(null);
                              setRevertError(null);
                            }}
                            className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                        {!captureConnectionId && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            Pick a credential in History to apply the revert.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
