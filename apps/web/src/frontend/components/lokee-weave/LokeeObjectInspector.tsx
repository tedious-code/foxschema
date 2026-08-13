/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only inspector for a Lokee graph node: table blueprint, column
 * change dates, and procedure/view source with line counts.
 */
import React, { useEffect, useState } from 'react';
import { parseTypeText } from '@foxschema/sql';
import { Loader2, X } from 'lucide-react';
import { inspectLokeeObject, type LokeeInspectResult, type LokeeStoredObject } from '../../api/lokeeApi';
import { objectStyle } from '../../lib/lokeeColors';
import { shortHash, type SchemaObjectNodeData } from './graphTypes';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeObjectInspectorProps {
  databaseId: string;
  selected: SchemaObjectNodeData;
  onClose: () => void;
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

export function LokeeObjectInspector({
  databaseId,
  selected,
  onClose,
}: LokeeObjectInspectorProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LokeeInspectResult | null>(null);

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

  const focus = data?.blueprint.object ?? data?.blueprint.container;
  const source =
    focus?.sourceText ??
    (typeof focus?.body.definition === 'string' ? focus.body.definition : null);
  const style = objectStyle(selected.objectType);

  return (
    <aside
      data-testid="lokee-object-inspector"
      className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-950/80"
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

            {data.growth.length > 1 && (
              <section data-testid="lokee-inspector-growth">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Table growth
                </h3>
                <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-slate-300">
                  {data.growth.map((g) => (
                    <li key={g.versionId} className="flex justify-between gap-2">
                      <span className="text-slate-500">v{g.versionNumber}</span>
                      <span>
                        {g.columns} cols · {g.indexes} idx · {g.triggers} trg
                      </span>
                    </li>
                  ))}
                </ul>
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
                    <li
                      key={`${point.versionId}:${point.operation}`}
                      className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2 text-slate-200">
                        <span className="font-semibold">
                          v{point.versionNumber} · {point.operation}
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
                        <div className="text-[10px] text-sky-400/80">
                          Reused hash — stored once (pointer)
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
