import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export type AutocompleteOption = {
  value: string;
  /** Shown instead of value when present. */
  label?: string;
  hint?: string;
};

export type AutocompleteTheme = {
  input: string;
  list: string;
  optionActive: string;
  optionIdle: string;
  empty: string;
};

/** Preset skins — callers can still override `className` on the input. */
export const autocompleteThemes = {
  /** Access Assistant, connections, admin panels. */
  slate: {
    input:
      'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[12px] font-mono text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50 placeholder:text-slate-500',
    list: 'absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-600 bg-slate-900 shadow-xl py-1',
    optionActive: 'bg-sky-500/20 text-sky-50',
    optionIdle: 'text-slate-200 hover:bg-slate-800',
    empty:
      'absolute z-30 left-0 right-0 mt-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-500',
  },
  /** SQL Editor blueprint / schema pickers. */
  violet: {
    input:
      'w-full bg-white/5 border border-violet-400/35 rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 disabled:opacity-50 placeholder:text-slate-500',
    list: 'absolute z-20 left-0 right-0 mt-1 max-h-44 overflow-y-auto rounded-lg border border-violet-400/30 bg-slate-800/95 backdrop-blur-md shadow-xl shadow-violet-950/40 py-1',
    optionActive: 'bg-violet-500/25 text-violet-50',
    optionIdle: 'text-slate-200 hover:bg-violet-500/15',
    empty:
      'absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-600/50 bg-slate-800/95 px-2.5 py-2 text-[11px] text-slate-400',
  },
} satisfies Record<string, AutocompleteTheme>;

export type AutocompleteThemeName = keyof typeof autocompleteThemes;

/** Rank options for typeahead — exported for unit tests and custom UIs. */
export function filterAutocompleteOptions(
  options: readonly AutocompleteOption[],
  query: string,
  maxResults = 80
): AutocompleteOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, maxResults);
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
  scored.sort((a, b) => b.score - a.score || a.o.value.localeCompare(b.o.value));
  return scored.slice(0, maxResults).map((x) => x.o);
}

/**
 * Accessible combobox with keyboard navigation and optional exact-match on blur.
 * Free text is allowed — suggestions assist typing, they do not restrict it.
 */
export const Autocomplete: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: readonly AutocompleteOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Overrides theme input classes when set. */
  className?: string;
  theme?: AutocompleteThemeName;
  maxResults?: number;
  /** Snap typed text to a catalog option when blur matches case-insensitively. */
  resolveExactOnBlur?: boolean;
  'data-testid'?: string;
}> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  theme = 'slate',
  maxResults = 80,
  resolveExactOnBlur = true,
  'data-testid': testId,
}) => {
  const skin = autocompleteThemes[theme];
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filtered = useMemo(
    () => filterAutocompleteOptions(options, value, maxResults),
    [options, value, maxResults]
  );

  useEffect(() => setHighlight(0), [value, open]);

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
    if (!resolveExactOnBlur) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const exact = options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
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
        className={className ?? skin.input}
      />
      {open && !disabled && filtered.length > 0 && (
        <ul id={listId} role="listbox" className={skin.list}>
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
                    active ? skin.optionActive : skin.optionIdle
                  }`}
                >
                  <span className="truncate font-semibold">{o.label ?? o.value}</span>
                  {o.hint && (
                    <span className="truncate text-[10px] text-slate-400 font-sans">{o.hint}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && !disabled && value.trim() && filtered.length === 0 && (
        <div className={skin.empty}>No matches</div>
      )}
    </div>
  );
};
