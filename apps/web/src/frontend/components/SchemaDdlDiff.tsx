/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Status-driven DDL diff for tables — the builder and its renderer.
 *
 * Extracted from `ObjectDetailPanel` so the version-history compare can show
 * the same coloured CREATE TABLE the live workspace shows. Both halves are
 * pure: `buildTableDdlDiffLines` needs a TableDiff and two dialect names, which
 * a stored version has as readily as a live connection.
 */
import React from 'react';
import { SqlGeneratorModule } from '../lib/sql-generator';
import type { TableDiff } from '../lib/types';
import { highlightMatch } from '../utils/highlight';

const ddlGenerator = new SqlGeneratorModule();

// ── Status-driven DDL diff for tables ────────────────────────────────────────
// A raw text diff of two rendered CREATE TABLEs mis-reads a column *reorder* as a
// change, and colours a source-only column as a deletion — when it's really an ADD
// the migration will apply to the target. So for tables we drive the colouring from
// the already-correct columnDiffs instead: render the source (the desired end state)
// column-by-column, tag each line by its ColumnDiff status, then append the
// target-only (REMOVED) columns. Same source of truth the column table uses.
export type DdlLineKind = 'added' | 'removed' | 'modified' | 'neutral';
export interface DdlDiffLine { kind: DdlLineKind; marker: string; text: string; }

const kindForStatus = (status?: string): DdlLineKind =>
  status === 'ADDED' ? 'added'
    : status === 'REMOVED' ? 'removed'
    : status === 'MODIFIED' ? 'modified'
    : 'neutral';

const markerForKind = (kind: DdlLineKind): string =>
  kind === 'added' ? '+' : kind === 'removed' ? '-' : kind === 'modified' ? '~' : ' ';

// Colour trailing CREATE INDEX / ADD CONSTRAINT lines by their own diff status.
const trailingLineKind = (text: string, diff: TableDiff, baseIsSource: boolean): DdlLineKind => {
  // security/detect-unsafe-regex false-positives here: no nested/overlapping
  // quantifiers, so no catastrophic backtracking — verified against a 50k-char
  // all-whitespace input at <1ms.
  // eslint-disable-next-line security/detect-unsafe-regex
  const idx = text.match(/^\s*CREATE(?:\s+UNIQUE)?\s+INDEX\s+(\S+)\s+ON\b/i);
  if (idx) {
    const st = (diff.indexDiffs ?? []).find((d) => d.name.toUpperCase() === idx[1].toUpperCase())?.status;
    return baseIsSource ? kindForStatus(st) : 'removed';
  }
  const fk = text.match(/ADD\s+CONSTRAINT\s+(\S+)\s+FOREIGN\s+KEY\b/i);
  if (fk) {
    const st = (diff.foreignKeyDiffs ?? []).find((d) => d.name.toUpperCase() === fk[1].toUpperCase())?.status;
    return baseIsSource ? kindForStatus(st) : 'removed';
  }
  return 'neutral';
};

export function buildTableDdlDiffLines(
  diff: TableDiff,
  sourceDialect: string,
  targetDialect: string,
  strip: (ddl: string) => string,
): DdlDiffLine[] {
  const src = diff.sourceTable;
  const tgt = diff.targetTable;
  const base = src ?? tgt;
  if (!base) return [];
  const baseIsSource = !!src;

  const colStatus = new Map<string, string>();
  for (const c of diff.columnDiffs ?? []) colStatus.set(c.name.toUpperCase(), c.status);

  const baseDialect = baseIsSource ? sourceDialect : targetDialect;
  // Render the table WITHOUT triggers — generateObjectDdl only appends the raw trigger
  // body (Oracle stores no CREATE TRIGGER header) and can't colour it, so we render
  // triggers ourselves below with a name header + status colour.
  const baseLines = strip(ddlGenerator.generateObjectDdl({ ...base, triggers: [] }, baseDialect)).split('\n');
  const out: DdlDiffLine[] = [];

  // renderCreateTable emits: header, one line per base.columns (in order), an optional
  // PK line, then ");" — so column N is baseLines[1 + N].
  out.push({ kind: 'neutral', marker: ' ', text: baseLines[0] ?? `CREATE TABLE ${base.name} (` });
  let li = 1;
  for (let c = 0; c < base.columns.length; c++, li++) {
    const kind = baseIsSource ? kindForStatus(colStatus.get(base.columns[c].name.toUpperCase())) : 'removed';
    out.push({ kind, marker: markerForKind(kind), text: baseLines[li] ?? '' });
  }

  // Target-only columns the migration will DROP — pull their rendered line from the
  // target side and slot them in after the desired column set.
  if (src && tgt) {
    const tgtLines = strip(ddlGenerator.generateObjectDdl({ ...tgt, triggers: [] }, targetDialect)).split('\n');
    tgt.columns.forEach((col, t) => {
      if (colStatus.get(col.name.toUpperCase()) === 'REMOVED') {
        out.push({ kind: 'removed', marker: '-', text: tgtLines[1 + t] ?? `  ${col.name}` });
      }
    });
  }

  // PK line, ");", and any CREATE INDEX / ADD CONSTRAINT lines appended after.
  for (; li < baseLines.length; li++) {
    const text = baseLines[li];
    if (text === undefined) continue;
    const kind = trailingLineKind(text, diff, baseIsSource);
    out.push({ kind, marker: markerForKind(kind), text });
  }

  // Triggers — rendered from triggerDiffs so we surface the name (Oracle keeps only the
  // raw body) and colour by status. Desired end-state triggers (source) first, then
  // target-only (REMOVED) ones.
  const pushTrigger = (
    name: string,
    trg: { timing?: string; event?: string; definition?: string },
    kind: DdlLineKind,
  ) => {
    const marker = markerForKind(kind);
    const meta = [trg.timing, trg.event].filter(Boolean).join(' ');
    out.push({ kind, marker, text: `-- TRIGGER ${name}${meta ? ` (${meta})` : ''}` });
    const body = (trg.definition ?? '').trim();
    if (body) for (const bl of body.split('\n')) out.push({ kind, marker, text: bl });
    else out.push({ kind, marker, text: '  -- no definition available' });
  };
  const trigDiffs = diff.triggerDiffs ?? [];
  for (const td of trigDiffs) {
    if (td.status === 'REMOVED') continue;
    const trg = td.source ?? td.target;
    if (trg) pushTrigger(td.name, trg, baseIsSource ? kindForStatus(td.status) : 'removed');
  }
  for (const td of trigDiffs) {
    if (td.status === 'REMOVED' && td.target) pushTrigger(td.name, td.target, 'removed');
  }

  // Trim trailing blank lines left by the DDL generator.
  while (out.length && out[out.length - 1].text.trim() === '') out.pop();

  return out;
}

/** Identifier-qualifier stripper, so a schema prefix is not read as a change. */
export function stripSchemaQualifiers(ddl: string, schemas: readonly (string | undefined)[]): string {
  let out = ddl;
  for (const s of schemas) {
    if (!s) continue;
    out = out.replace(new RegExp(`\\b${s}\\.`, 'gi'), '');
    out = out.replace(new RegExp(`"${s}"\\s*\\.\\s*`, 'gi'), '');
  }
  return out;
}

const LINE_TEXT: Record<DdlLineKind, string> = {
  added: 'text-emerald-300',
  removed: 'text-rose-300',
  modified: 'text-amber-300',
  neutral: 'text-slate-300',
};

const LINE_BG: Record<DdlLineKind, string> = {
  added: 'bg-emerald-500/10',
  removed: 'bg-rose-500/10',
  modified: 'bg-amber-500/10',
  neutral: '',
};

/** The coloured CREATE TABLE itself. Props only — no store, no dialogs. */
export function DdlDiffLines({
  lines,
  query = '',
  testId,
}: {
  lines: readonly DdlDiffLine[];
  query?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <table data-testid={testId} className="w-full font-mono text-[12px] border-collapse">
      <tbody>
        {lines.map((line, i) => (
          <tr key={i} className={LINE_BG[line.kind]}>
            <td className={`w-6 text-center select-none align-top ${LINE_TEXT[line.kind]}`}>
              {line.marker}
            </td>
            <td
              className={`px-3 py-0.5 whitespace-pre ${LINE_TEXT[line.kind]} ${
                line.kind === 'removed' ? 'line-through decoration-rose-500/30' : ''
              }`}
            >
              {highlightMatch(line.text, query)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
