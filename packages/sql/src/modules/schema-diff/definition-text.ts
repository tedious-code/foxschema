/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * When are two object definitions (view, routine, trigger body) the same?
 *
 * One answer, used by Compare and by Lokee's content hash. They used to decide
 * it separately, and disagreed: Compare folded case and dropped schema
 * qualifiers, Lokee only collapsed whitespace — so an object Compare called
 * UNCHANGED could still mint a new Lokee version.
 *
 * The result is a comparison key, not SQL. Never execute it or show it: case
 * has been folded, qualifiers removed and the terminator dropped.
 */
import { escapeRegExp } from '../../cores/escape-regexp.js';

/**
 * Remove `schema.` qualifiers for the named schemas wherever they appear —
 * bracketed (`[demo_a].`), quoted (`"demo_a".`), backticked or bare, any case.
 * Position-independent, so it catches `ON demo_a.customers`,
 * `NEXT VALUE FOR [demo_a].[order_seq]`, `demo_a.fn(...)` — anything the
 * syntactic strips in {@link normalizeDefinitionText} miss.
 */
export function stripSchemaQualifiers(text: string, schemas: readonly string[]): string {
  let out = text;
  for (const schema of schemas) {
    if (!schema) continue;
    const esc = escapeRegExp(schema);
    out = out.replace(new RegExp(`(?:\\[${esc}\\]|"${esc}"|\`${esc}\`|\\b${esc}\\b)\\s*\\.\\s*`, 'gi'), '');
  }
  return out;
}

/**
 * Lower-case everything except the contents of single-quoted string literals.
 *
 * Engines fold and re-quote identifiers and keywords (Postgres lower-cases an
 * unquoted name on storage), so their case is not meaning. A literal's case is:
 * `status = 'Active'` and `status = 'active'` select different rows, and
 * folding them made a real change read as UNCHANGED. `''` inside a literal is
 * an escaped quote and keeps the literal open. Comments are folded like code,
 * so an apostrophe in `-- don't` does not open a literal.
 */
function lowerCaseOutsideLiterals(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += text.slice(i, stop).toLowerCase();
      i = stop;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).toLowerCase();
      i = stop;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== "'" && !(text[j] === '-' && text[j + 1] === '-') && !(text[j] === '/' && text[j + 1] === '*')) j++;
    if (j === i) j = i + 1;
    out += text.slice(i, j).toLowerCase();
    i = j;
  }
  return out;
}

/**
 * The comparison key for a procedural definition: whitespace collapsed, case
 * folded outside string literals, schema qualifiers removed (for `schemas`,
 * and syntactically after CREATE / FROM / JOIN / … and before a routine call),
 * trailing terminator dropped.
 *
 * `schemas` are the schema names this definition may be qualified with — the
 * two sides of a compare, or the schema a Lokee history was captured from.
 */
export function normalizeDefinitionText(
  definition: string | undefined | null,
  schemas: readonly string[] = []
): string {
  if (!definition) return '';
  // Comments go before whitespace is collapsed: a `--` comment runs to the end
  // of its line, and once newlines are gone there is no line end to stop at.
  const folded = lowerCaseOutsideLiterals(stripSchemaQualifiers(definition, schemas));
  return (
    folded
      .replace(/\s+/g, ' ')
      .trim()
      // Strip schema qualifier from the object name in CREATE statements:
      //   CREATE OR REPLACE FUNCTION app.fn_get_discount → ... FUNCTION fn_get_discount
      .replace(/\b(function|procedure|view|trigger|table)\s+"?[\w$]+"?\s*\.\s*"?/g, '$1 ')
      // Strip schema qualifiers from table references inside the body, e.g.
      //   FROM app.orders → FROM orders
      //   JOIN demo_b.order_items → JOIN order_items
      .replace(/\b(from|join|update|into|table)\s+"?[\w$]+"?\s*\.\s*"?/g, '$1 ')
      // Strip a schema qualifier before a routine call in the body, e.g.
      //   demo_a.fn_tier_priority(:new.tier) → fn_tier_priority(:new.tier)
      // The migration re-qualifies such calls to the target schema, so this keeps an
      // otherwise-identical trigger/routine from reading as MODIFIED after a deploy.
      // Guarded by the trailing "(" so it never touches record refs like :new.tier.
      .replace(/\b[\w$]+\s*\.\s*([\w$]+\s*\()/g, '$1')
      // Drop a trailing statement terminator — `... END` vs `... END;` is the same
      // routine (SQL Server stores the body with/without it inconsistently).
      .replace(/\s*;\s*$/, '')
  );
}
