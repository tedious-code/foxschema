/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Date / timestamp field control for Data Peek forms.
 * Users can type in the catalog format or pick from a small calendar popover.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import {
  dateInputFromDraft,
  draftFromDateInput,
  timestampFormatHint,
} from '@/features/sql-editor/lib/peekValueGenerators';
import { SQL_ICON_STROKE } from '@/shared/lib/iconStyle';

interface Props {
  fieldName: string;
  kind: 'date' | 'timestamp';
  value: string;
  showError: boolean;
  disabled?: boolean;
  onChange: (next: string) => void;
  onBlur: () => void;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export const PeekDatePicker: React.FC<Props> = ({
  fieldName,
  kind,
  value,
  showError,
  disabled,
  onChange,
  onBlur,
}) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(value);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTyped(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const parsed = useMemo(() => {
    const html = dateInputFromDraft(kind, value);
    if (!html) {
      const now = new Date();
      return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
    }
    const [datePart] = html.split('T');
    const [ys, ms, ds] = datePart!.split('-').map(Number);
    return { y: ys!, m: (ms ?? 1) - 1, d: ds ?? 1 };
  }, [kind, value]);

  const [view, setView] = useState(parsed);
  useEffect(() => {
    if (open) setView({ y: parsed.y, m: parsed.m, d: parsed.d });
  }, [open, parsed.y, parsed.m, parsed.d]);

  const inputClass = `mt-0.5 w-full rounded-md border bg-slate-950 px-2.5 py-1.5 text-[13px] font-mono text-slate-100 outline-none disabled:opacity-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
    showError ? 'border-rose-500/70 focus:border-rose-400' : 'border-slate-700 accent-focus'
  }`;

  const commitTyped = () => {
    const next = typed.trim();
    onChange(next);
    onBlur();
  };

  const pickDay = (day: number) => {
    const y = view.y;
    const m = String(view.m + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    if (kind === 'date') {
      onChange(`${y}-${m}-${d}`);
    } else {
      const existing = dateInputFromDraft('timestamp', value);
      const time = existing.includes('T') ? existing.split('T')[1] : '00:00';
      onChange(draftFromDateInput('timestamp', `${y}-${m}-${d}T${time}`));
    }
    setOpen(false);
  };

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const dim = daysInMonth(view.y, view.m);
  const cells: Array<number | null> = [...Array(firstDow).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="relative flex items-stretch gap-1" ref={rootRef}>
      <input
        data-testid={`peek-row-field-${fieldName}`}
        value={typed}
        disabled={disabled}
        aria-invalid={showError || undefined}
        placeholder={timestampFormatHint(kind)}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commitTyped}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitTyped();
          }
        }}
        className={`${inputClass} flex-1`}
      />
      <button
        type="button"
        data-testid={`peek-row-datepicker-${fieldName}`}
        title={`Pick ${kind === 'date' ? 'date' : 'date & time'} (${timestampFormatHint(kind)})`}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-0.5 shrink-0 rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-400 hover:text-sky-200 hover:border-sky-500/40 hover:bg-sky-500/10 disabled:opacity-40"
      >
        <CalendarDays className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
      </button>
      {kind === 'timestamp' && (
        <input
          data-testid={`peek-row-datetime-native-${fieldName}`}
          type="datetime-local"
          value={dateInputFromDraft('timestamp', value)}
          disabled={disabled}
          onChange={(e) => onChange(draftFromDateInput('timestamp', e.target.value))}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
      )}
      {open && (
        <div
          data-testid={`peek-row-datepicker-pop-${fieldName}`}
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-slate-700 bg-slate-900 p-2 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
              onClick={() =>
                setView((v) => {
                  const m = v.m - 1;
                  return m < 0 ? { y: v.y - 1, m: 11, d: 1 } : { ...v, m, d: 1 };
                })
              }
            >
              ‹
            </button>
            <span className="text-[11px] font-semibold text-slate-200">
              {new Date(view.y, view.m, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' })}
            </span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
              onClick={() =>
                setView((v) => {
                  const m = v.m + 1;
                  return m > 11 ? { y: v.y + 1, m: 0, d: 1 } : { ...v, m, d: 1 };
                })
              }
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-500 mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) =>
              day == null ? (
                <span key={`e-${i}`} />
              ) : (
                <button
                  key={`${view.y}-${view.m}-${day}`}
                  type="button"
                  className={`rounded py-1 text-[11px] ${
                    day === parsed.d && view.m === parsed.m && view.y === parsed.y
                      ? 'bg-sky-500/30 text-sky-100'
                      : 'text-slate-200 hover:bg-slate-800'
                  }`}
                  onClick={() => pickDay(day)}
                >
                  {day}
                </button>
              )
            )}
          </div>
          {kind === 'timestamp' && (
            <label className="mt-2 block text-[10px] text-slate-500">
              Time
              <input
                type="time"
                step={1}
                data-testid={`peek-row-time-${fieldName}`}
                className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[12px] text-slate-100"
                value={(() => {
                  const html = dateInputFromDraft('timestamp', value);
                  if (!html.includes('T')) return '00:00:00';
                  const t = html.split('T')[1]!;
                  return t.length === 5 ? `${t}:00` : t;
                })()}
                onChange={(e) => {
                  const datePart =
                    dateInputFromDraft('date', value) ||
                    `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(view.d).padStart(2, '0')}`;
                  const t = e.target.value.length === 5 ? `${e.target.value}:00` : e.target.value;
                  onChange(`${datePart} ${t}`);
                }}
              />
            </label>
          )}
          <p className="mt-2 text-[10px] text-slate-500">Type {timestampFormatHint(kind)} or pick a day</p>
        </div>
      )}
    </div>
  );
};
