/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A text input that suggests values it already knows, and still accepts one it
 * does not.
 *
 * Built on `<datalist>` rather than a custom popup: the browser supplies
 * filtering, keyboard navigation and screen-reader support, and typing a value
 * that is not on the list stays legal. That last part matters for a schema box,
 * where the list can be stale, unreadable by the current account, or simply
 * something the user is about to create.
 */
import React, { useId } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Known values to suggest. Duplicates and blanks are dropped. */
  options: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  /** Shown while the options are still being fetched. */
  loading?: boolean;
  className?: string;
  'data-testid'?: string;
  'aria-label'?: string;
}

export const ComboInput: React.FC<Props> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  loading,
  className,
  'data-testid': testId,
  'aria-label': ariaLabel,
}) => {
  const listId = useId();
  const suggestions = [...new Set(options.filter((o) => o.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );

  return (
    <>
      <input
        type="text"
        role="combobox"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={loading ? 'Loading…' : placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={suggestions.length > 0}
        autoComplete="off"
        spellCheck={false}
        data-testid={testId}
        className={
          className ??
          'w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs text-slate-200 ' +
            'placeholder:text-slate-600 focus:outline-none focus:border-sky-600 disabled:opacity-50'
        }
      />
      <datalist id={listId} data-testid={testId ? `${testId}-options` : undefined}>
        {suggestions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
};
