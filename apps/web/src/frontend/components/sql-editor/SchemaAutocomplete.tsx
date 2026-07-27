import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export type AutocompleteOption = {
  value: string;
  /** Shown instead of value when present. */
  label?: string;
  hint?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
};

function filterOptions(
  options: AutocompleteOption[],
  query: string
): AutocompleteOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, 60);
  const scored: { o: AutocompleteOption; score: number }[] = [];
  for (const o of options) {
    const v = o.value.toLowerCase();
    const l = (o.label ?? o.value).toLowerCase();
    let score = 0;
    if (v === q) score = 100;
    else if (v.startsWith(q)) score = 80;
    else if (v.includes(q)) score = 50;
    else if (l.includes(q)) score = 30;
    else continue;
    scored.push({ o, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.o.value.localeCompare(b.o.value)
  );
  return scored.slice(0, 60).map((x) => x.o);
}

/** Typeahead over schema names (tables / columns) with keyboard support. */
export const SchemaAutocomplete: React.FC<Props> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  'data-testid': testId,
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filtered = useMemo(() => filterOptions(options, value), [options, value]);

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const resolveExact = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const exact = options.find(
      (o) => o.value.toLowerCase() === trimmed.toLowerCase()
    );
    if (exact && exact.value !== value) onChange(exact.value);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        data-testid={testId}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            resolveExact();
            setOpen(false);
          }, 140);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && filtered[highlight]) {
            e.preventDefault();
            pick(filtered[highlight]!.value);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={
          className ??
          'w-full bg-white/5 border border-violet-400/35 rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 disabled:opacity-50 placeholder:text-slate-500'
        }
      />
      {open && !disabled && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-44 overflow-y-auto rounded-lg border border-violet-400/30 bg-slate-800/95 backdrop-blur-md shadow-xl shadow-violet-950/40 py-1"
        >
          {filtered.map((o, i) => {
            const active = i === highlight;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.value)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-baseline gap-2 px-2.5 py-1.5 text-left text-[12px] font-mono ${
                    active
                      ? 'bg-violet-500/25 text-violet-50'
                      : 'text-slate-200 hover:bg-violet-500/15'
                  }`}
                >
                  <span className="truncate font-semibold">{o.label ?? o.value}</span>
                  {o.hint && (
                    <span className="truncate text-[10px] text-slate-400 font-sans">
                      {o.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && !disabled && value.trim() && filtered.length === 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-600/50 bg-slate-800/95 px-2.5 py-2 text-[11px] text-slate-400">
          No matches
        </div>
      )}
    </div>
  );
};
