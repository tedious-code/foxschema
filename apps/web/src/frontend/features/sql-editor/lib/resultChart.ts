/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detect a label + number grid that can be drawn as an opt-in SVG bar chart.
 * No chart library; pies are out of scope.
 */

export const MAX_CHART_POINTS = 40;

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSeries {
  labelColumn: string;
  valueColumn: string;
  points: ChartPoint[];
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isNumericColumn(rows: unknown[][], col: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const value = row[col];
    if (value == null || value === '') continue;
    if (asNumber(value) == null) return false;
    seen += 1;
    if (seen >= 8) break;
  }
  return seen > 0;
}

function cellLabel(value: unknown): string {
  if (value == null) return '∅';
  if (typeof value === 'string') return value || '∅';
  return String(value);
}

/** First label column + first numeric measure, or null when the grid is not chartable. */
export function chartableSeries(columns: string[], rows: unknown[][]): ChartSeries | null {
  if (columns.length < 2 || rows.length === 0) return null;
  const numeric = columns.map((_, i) => isNumericColumn(rows, i));
  const numericIdx = numeric.findIndex(Boolean);
  if (numericIdx < 0) return null;
  const nonNumericIdx = numeric.findIndex((n) => !n);
  const labelIdx = nonNumericIdx >= 0 ? nonNumericIdx : 0;
  const valueIdx =
    nonNumericIdx >= 0
      ? numericIdx
      : numeric.findIndex((n, i) => n && i !== labelIdx);
  if (valueIdx < 0 || valueIdx === labelIdx) return null;

  const points: ChartPoint[] = [];
  for (const row of rows) {
    if (points.length >= MAX_CHART_POINTS) break;
    const value = asNumber(row[valueIdx]);
    if (value == null) continue;
    points.push({ label: cellLabel(row[labelIdx]), value });
  }
  if (points.length === 0) return null;
  return {
    labelColumn: columns[labelIdx] ?? 'label',
    valueColumn: columns[valueIdx] ?? 'value',
    points,
  };
}
