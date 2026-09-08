/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Opt-in SVG bar chart for a label + number result grid. No chart library.
 */
import React, { useMemo } from 'react';
import type { ChartSeries } from '../lib/resultChart';

const WIDTH = 640;
const HEIGHT = 180;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 36;

export const ResultChart: React.FC<{
  series: ChartSeries;
  testId?: string;
}> = ({ series, testId = 'sql-result-chart' }) => {
  const max = useMemo(
    () => Math.max(...series.points.map((p) => p.value), 0) || 1,
    [series.points]
  );
  const innerW = WIDTH - PAD_L - PAD_R;
  const innerH = HEIGHT - PAD_T - PAD_B;
  const gap = series.points.length > 1 ? innerW / series.points.length : innerW;
  const barW = Math.max(4, Math.min(28, gap * 0.62));

  return (
    <div
      className="shrink-0 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5"
      data-testid={testId}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
        {series.valueColumn}
        <span className="font-semibold normal-case tracking-normal text-slate-600">
          {' '}
          by {series.labelColumn}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-[9.5rem]"
        role="img"
        aria-label={`${series.valueColumn} by ${series.labelColumn}`}
      >
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={PAD_L}
          y2={PAD_T + innerH}
          className="stroke-slate-700"
          strokeWidth={1}
        />
        <line
          x1={PAD_L}
          y1={PAD_T + innerH}
          x2={PAD_L + innerW}
          y2={PAD_T + innerH}
          className="stroke-slate-700"
          strokeWidth={1}
        />
        {series.points.map((p, i) => {
          const h = (p.value / max) * innerH;
          const x = PAD_L + gap * i + (gap - barW) / 2;
          const y = PAD_T + innerH - h;
          return (
            <g key={`${p.label}-${i}`}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 1)}
                rx={2}
                className="fill-sky-500/80"
                data-testid={`${testId}-bar-${i}`}
              >
                <title>
                  {p.label}: {p.value}
                </title>
              </rect>
              <text
                x={x + barW / 2}
                y={PAD_T + innerH + 12}
                textAnchor="middle"
                className="fill-slate-500"
                fontSize={9}
              >
                {p.label.length > 10 ? `${p.label.slice(0, 9)}…` : p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
