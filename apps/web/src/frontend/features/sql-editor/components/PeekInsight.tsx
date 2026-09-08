/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Catalog-only table insight for Data Peek. Mounted only when the Insight tab
 * is selected — opening Peek must not fetch this.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchTableInsight, type TableInsightResponse } from '@/shared/api/schemaApi';
import { tableNameParts } from '@/shared/lib/tablePreview';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { StatCard } from '@/shared/components/surfaces';

function tableRef(tableName: string, fallbackSchema?: string): { table: string; schema?: string } {
  const parts = tableNameParts(tableName);
  if (parts.length > 1) {
    return { schema: parts[0], table: parts[parts.length - 1]! };
  }
  return { table: tableName, schema: fallbackSchema };
}

function pct(frac: number | null | undefined): string {
  if (frac == null || Number.isNaN(frac)) return '—';
  return `${Math.round(frac * 1000) / 10}%`;
}


/** Bytes as a person reads them. Binary units, since that is what catalogs report. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10 so 1.2 GB does not collapse to 1 GB, none above it
  // where the extra digit is noise against the rounding already in the number.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export const PeekInsight: React.FC<{
  connectionId: string;
  tableName: string;
  schema?: string;
}> = ({ connectionId, tableName, schema }) => {
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const [data, setData] = useState<TableInsightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ref = tableRef(tableName, schema);
    setLoading(true);
    setError(null);
    void fetchTableInsight(
      { connectionId, password: sessionPasswords[connectionId] || undefined },
      { table: ref.table, schema: ref.schema }
    )
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, tableName, schema, sessionPasswords]);

  const cards = useMemo(() => {
    if (!data) return null;
    const nullHeavy = [...data.columns]
      .filter((c) => c.nullFrac != null && c.nullFrac >= 0.2)
      .sort((a, b) => (b.nullFrac ?? 0) - (a.nullFrac ?? 0))
      .slice(0, 3);
    const distinctHeavy = [...data.columns]
      .filter((c) => c.nDistinct != null && c.nDistinct > 0)
      .sort((a, b) => (b.nDistinct ?? 0) - (a.nDistinct ?? 0))
      .slice(0, 3);
    const withNull = data.columns.filter((c) => c.nullFrac != null);
    const avgNull =
      withNull.length === 0
        ? null
        : withNull.reduce((sum, c) => sum + (c.nullFrac ?? 0), 0) / withNull.length;
    return { nullHeavy, distinctHeavy, avgNull: Number.isFinite(avgNull) ? avgNull : null };
  }, [data]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1" data-testid="data-peek-insight">
      {loading && (
        <p className="flex items-center gap-2 text-[12px] text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Reading catalog stats…
        </p>
      )}
      {error && (
        <p className="text-[12px] text-rose-300" data-testid="data-peek-insight-error">
          {error}
        </p>
      )}
      {data && cards && (
        <>
          <div
            className="grid grid-cols-3 gap-2 mb-3"
            data-testid="data-peek-insight-cards"
          >
            <StatCard
              testId="data-peek-insight-card-rows"
              label="Rows"
              value={data.estimatedRows == null ? '—' : data.estimatedRows.toLocaleString()}
              hint="Estimated from catalog"
            />
            <StatCard
              testId="data-peek-insight-card-size"
              label="Size"
              value={data.sizeBytes == null ? '—' : formatBytes(data.sizeBytes)}
              hint={data.sizeBytes == null ? 'Not reported by this engine' : 'Table + indexes'}
            />
            <StatCard
              testId="data-peek-insight-card-nulls"
              label="Null-heavy"
              tone="warning"
              value={
                cards.nullHeavy.length === 0
                  ? 'None ≥20%'
                  : cards.nullHeavy.map((c) => c.name).join(', ')
              }
              hint={`Avg null ${pct(cards.avgNull)}`}
            />
            <StatCard
              testId="data-peek-insight-card-distinct"
              label="High distinct"
              tone="info"
              value={
                cards.distinctHeavy.length === 0
                  ? '—'
                  : cards.distinctHeavy.map((c) => `${c.name} (${c.nDistinct})`).join(', ')
              }
              hint="Top nDistinct columns"
            />
          </div>

          <p className="mb-2 text-[12px] text-slate-300" data-testid="data-peek-insight-rows">
            Estimated rows:{' '}
            <span className="font-mono font-semibold text-slate-100">
              {data.estimatedRows == null ? '—' : data.estimatedRows.toLocaleString()}
            </span>
            {data.support?.hint ? (
              <span className="block text-[11px] text-slate-500 mt-0.5">{data.support.hint}</span>
            ) : null}
          </p>

          {data.columns.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-500">No column stats in the catalog.</p>
          ) : (
            <table className="mt-1 w-full text-[11px]" data-testid="data-peek-insight-columns">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left font-bold py-1">Column</th>
                  <th className="text-right font-bold py-1">nDistinct</th>
                  <th className="text-right font-bold py-1">null %</th>
                  <th className="text-left font-bold py-1 pl-3 w-[40%]">null density</th>
                </tr>
              </thead>
              <tbody>
                {data.columns.map((c) => {
                  const nullPct = c.nullFrac == null ? 0 : Math.min(1, Math.max(0, c.nullFrac));
                  return (
                    <tr key={c.name} data-testid={`data-peek-insight-col-${c.name}`}>
                      <td className="font-mono text-slate-200 py-0.5">{c.name}</td>
                      <td className="text-right tabular-nums text-slate-300">
                        {c.nDistinct == null ? '—' : c.nDistinct}
                      </td>
                      <td className="text-right tabular-nums text-slate-300">
                        {pct(c.nullFrac)}
                      </td>
                      <td className="pl-3 py-0.5">
                        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500/70"
                            style={{ width: `${nullPct * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};
