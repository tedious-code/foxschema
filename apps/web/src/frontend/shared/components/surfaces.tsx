/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three surfaces every screen in this app is built out of.
 *
 * They were extracted by counting, not by taste. The frontend held 85 distinct
 * card/panel class strings, and the small uppercase label above a group came in
 * eight spellings — `text-[10px]` and `text-[11px]`, `tracking-wide` and
 * `tracking-wider`, `text-slate-400` and `text-slate-500` — across some seventy
 * uses. None of that variation meant anything; it is what a screen looks like
 * when each one is written on its own.
 *
 * `labelCls` in the access feature already said this once, but it lives inside
 * a feature, so nothing else could reach it without crossing a boundary the
 * architecture test forbids. Shared is where a primitive every feature needs
 * belongs.
 */
import React from 'react';

/** The uppercase micro-label that titles a group. One spelling, everywhere. */
export const sectionLabelCls = 'text-[10px] font-bold uppercase tracking-wide text-slate-500';

/** The app's card treatment: one border, one ground, one radius. */
export const panelCls = 'rounded-lg border border-slate-800 bg-slate-950/50';

export const SectionLabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <p className={className ? `${sectionLabelCls} ${className}` : sectionLabelCls}>{children}</p>
);

export const Panel: React.FC<{
  children: React.ReactNode;
  /** Extra classes. Padding is part of the treatment, not a choice. */
  className?: string;
  testId?: string;
}> = ({ children, className, testId }) => (
  <div className={[panelCls, 'px-2.5 py-2', className].filter(Boolean).join(' ')} data-testid={testId}>
    {children}
  </div>
);

/**
 * How much of a thing there is, and what that number came from.
 *
 * Label, value, and a line of provenance under it — the shape Peek Insight and
 * the snapshot briefing had each grown separately. The hint is not decoration:
 * a row count read from a catalog estimate and one read by counting are
 * different claims, and the card is where that gets said.
 */
export type StatTone = 'default' | 'positive' | 'warning' | 'danger' | 'info';

const TONE_CLS: Record<StatTone, string> = {
  default: 'text-slate-100',
  positive: 'text-emerald-300',
  warning: 'text-amber-200',
  danger: 'text-rose-300',
  info: 'text-sky-200',
};

export const StatCard: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
  testId?: string;
}> = ({ label, value, hint, tone = 'default', testId }) => (
  <Panel testId={testId}>
    <SectionLabel>{label}</SectionLabel>
    <p className={`mt-1 font-mono text-sm font-semibold ${TONE_CLS[tone]}`}>{value}</p>
    {hint != null && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
  </Panel>
);
