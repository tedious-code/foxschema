import React from 'react';

/**
 * Wrap every (case-insensitive) occurrence of `query` in `text` with a <mark>,
 * so a matched search keyword stands out. `query` must already be lowercased.
 * Uses indexOf rather than a RegExp so the query needs no escaping.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  let at = lower.indexOf(query);
  if (at === -1) return text;

  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={key++} className="bg-cyan-400/25 text-cyan-200 rounded-sm px-0.5">
        {text.slice(at, at + query.length)}
      </mark>
    );
    from = at + query.length;
    at = lower.indexOf(query, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
