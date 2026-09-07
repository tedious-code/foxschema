/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Catalog-only table insight for Data Peek. Mounted only when the Insight tab
 * is selected — opening Peek must not fetch this.
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchTableInsight, type TableInsightResponse } from '@/shared/api/schemaApi';
import { tableNameParts } from '@/shared/lib/tablePreview';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';

function tableRef(tableName: string, fallbackSchema?: string): { table: string; schema?: string } {
  const parts = tableNameParts(tableName);
  if (parts.length > 1) {
    return { schema: parts[0], table: parts[parts.length - 1]! };
  }
  return { table: tableName, schema: fallbackSchema };
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
      {data && (
        <>
          <p className="text-[12px] text-slate-300" data-testid="data-peek-insight-rows">
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
            <table className="mt-2 w-full text-[11px]" data-testid="data-peek-insight-columns">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left font-bold py-1">Column</th>
                  <th className="text-right font-bold py-1">nDistinct</th>
                  <th className="text-right font-bold py-1">null %</th>
                </tr>
              </thead>
              <tbody>
                {data.columns.map((c) => (
                  <tr key={c.name} data-testid={`data-peek-insight-col-${c.name}`}>
                    <td className="font-mono text-slate-200 py-0.5">{c.name}</td>
                    <td className="text-right tabular-nums text-slate-300">
                      {c.nDistinct == null ? '—' : c.nDistinct}
                    </td>
                    <td className="text-right tabular-nums text-slate-300">
                      {c.nullFrac == null ? '—' : `${Math.round(c.nullFrac * 1000) / 10}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};
