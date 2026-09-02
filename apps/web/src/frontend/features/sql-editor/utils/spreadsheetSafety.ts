/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keep exported cells from being executed as spreadsheet formulas.
 *
 * Excel, Google Sheets and LibreOffice all treat a cell beginning with `=`,
 * `+`, `-`, `@`, tab or CR as a formula. Result grids render whatever the
 * queried database holds, so a row written by someone else — a shared staging
 * database, an imported file, an application's own user-supplied data — can
 * carry `=HYPERLINK(...)` or a `WEBSERVICE()` call that fires the moment the
 * export is opened. The grid itself is safe (React escapes text); the risk is
 * created by exporting, so the fix belongs on the export paths.
 *
 * The prefix is a single quote, which every major spreadsheet consumes as
 * "treat the rest as literal text".
 */

const RISKY_LEAD = /^[=+\-@\t\r]/;

/**
 * Plain numbers are exempt: `-5` and `+3.2e4` are overwhelmingly ordinary data,
 * and quoting them would turn numeric columns into text in the opened sheet —
 * breaking every SUM in the file to defend against nothing.
 *
 * Parsed rather than pattern-matched: `Number` is linear on any input, where a
 * numeric regex with nested quantifiers is the kind of thing that gets flagged
 * as backtracking-prone. Only `+` and `-` can legitimately begin a number, so
 * `=`, `@`, tab and CR are never exempted.
 */
function isPlainNumber(text: string): boolean {
  if (text[0] !== '+' && text[0] !== '-') return false;
  // Number() skips surrounding whitespace; a padded value is text, not a number.
  if (text.trim() !== text) return false;
  return Number.isFinite(Number(text));
}

export function neutralizeSpreadsheetFormula(text: string): string {
  if (!RISKY_LEAD.test(text)) return text;
  if (isPlainNumber(text)) return text;
  return `'${text}`;
}
