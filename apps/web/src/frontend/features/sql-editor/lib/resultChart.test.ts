/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { MAX_CHART_POINTS, chartableSeries } from './resultChart';

describe('chartableSeries', () => {
  it('maps a label + number grid', () => {
    const series = chartableSeries(
      ['region', 'orders'],
      [
        ['east', 12],
        ['west', 7],
      ]
    );
    expect(series).toEqual({
      labelColumn: 'region',
      valueColumn: 'orders',
      points: [
        { label: 'east', value: 12 },
        { label: 'west', value: 7 },
      ],
    });
  });

  it('uses the first column as label when every column is numeric', () => {
    const series = chartableSeries(
      ['year', 'revenue'],
      [
        [2024, 100],
        [2025, 140],
      ]
    );
    expect(series?.labelColumn).toBe('year');
    expect(series?.valueColumn).toBe('revenue');
    expect(series?.points[0]).toEqual({ label: '2024', value: 100 });
  });

  it('rejects a single-column grid and a string-only grid', () => {
    expect(chartableSeries(['name'], [['a']])).toBeNull();
    expect(
      chartableSeries(
        ['a', 'b'],
        [
          ['x', 'y'],
          ['p', 'q'],
        ]
      )
    ).toBeNull();
  });

  it('caps points so a large page stays a cheap SVG', () => {
    const rows = Array.from({ length: MAX_CHART_POINTS + 15 }, (_, i) => [`n${i}`, i]);
    const series = chartableSeries(['name', 'n'], rows);
    expect(series?.points).toHaveLength(MAX_CHART_POINTS);
  });
});
