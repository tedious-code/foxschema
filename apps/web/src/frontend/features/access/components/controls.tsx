/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Form controls shared by the Access panels, so the Permission Builder and
 * User Management read as one screen rather than two.
 */
import React from 'react';
import type { PermissionRisk } from '../lib/access';

export const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none focus:border-sky-500';

export const RISK_STYLE: Record<PermissionRisk, string> = {
  low: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  elevated: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  administrative: 'text-orange-300 border-orange-500/40 bg-orange-500/10',
  critical: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
};

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div>
    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
    {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    <div className="mt-1">{children}</div>
  </div>
);

export const Segmented: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  testId: string;
}> = ({ value, onChange, options, testId }) => (
  <div
    className="inline-flex rounded-md border border-slate-700 overflow-hidden"
    data-testid={testId}
  >
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        disabled={o.disabled}
        title={o.title}
        data-testid={`${testId}-${o.value}`}
        onClick={() => onChange(o.value)}
        className={`px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-35 disabled:cursor-not-allowed ${
          value === o.value ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const EmptyState: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-6 text-center">
    <p className="text-sm font-bold text-slate-300">{title}</p>
    <p className="mt-1 text-[11px] text-slate-500 max-w-md mx-auto">{body}</p>
  </div>
);
