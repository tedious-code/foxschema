/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A schema change report in Markdown, for people who do not read DDL.
 *
 * The Migration SQL tab already answers "what will run". This answers "what
 * changed", for the reviewer, the ticket, or the change-approval board — so it
 * deliberately contains **no SQL at all**. A column widening reads "email:
 * varchar(100) → varchar(255)", not an ALTER statement.
 *
 * Pure and string-only: no DOM, no download, no store. The caller decides what
 * to do with the text, and the shape of the output can be asserted directly.
 */
import type { SchemaCompareResult, TableDiff } from './types';

export interface MigrationReportMeta {
  /** e.g. "Version 2" — the reference side. */
  originalLabel: string;
  /** e.g. "Version 3" or "Current database". */
  targetLabel: string;
  /** Database the history belongs to, as shown in the picker. */
  databaseLabel?: string;
  /** Defaults to now; injected so tests are not clock-dependent. */
  generatedAt?: Date;
}

const STATUS_WORD: Record<string, string> = {
  ADDED: 'Added',
  REMOVED: 'Removed',
  MODIFIED: 'Changed',
  UNCHANGED: 'Unchanged',
};

/** `varchar(100) → varchar(255)`, or one side when the column exists once. */
function typeChange(from?: string, to?: string): string {
  if (from && to && from !== to) return `${from} → ${to}`;
  return to ?? from ?? '';
}

/** Plain-language lines for what moved inside one object. */
function objectDetails(diff: TableDiff): string[] {
  const lines: string[] = [];

  for (const column of diff.columnDiffs) {
    if (column.status === 'UNCHANGED') continue;
    if (column.status === 'ADDED') {
      const type = column.source?.type ?? '';
      lines.push(`- Added column \`${column.name}\`${type ? ` (${type})` : ''}`);
    } else if (column.status === 'REMOVED') {
      lines.push(`- Removed column \`${column.name}\``);
    } else {
      const change = typeChange(column.target?.type, column.source?.type);
      const bits: string[] = [];
      if (change.includes('→')) bits.push(change);
      if (column.source && column.target && column.source.nullable !== column.target.nullable) {
        bits.push(column.source.nullable ? 'now nullable' : 'now required');
      }
      lines.push(
        `- Changed column \`${column.name}\`${bits.length ? `: ${bits.join(', ')}` : ''}`
      );
    }
  }

  for (const index of diff.indexDiffs) {
    if (index.status === 'UNCHANGED') continue;
    const columns = (index.source ?? index.target)?.columns?.join(', ') ?? '';
    const name = index.source?.name ?? index.target?.name ?? index.name;
    lines.push(
      `- ${STATUS_WORD[index.status] ?? index.status} index \`${name}\`${columns ? ` on (${columns})` : ''}`
    );
  }

  for (const fk of diff.foreignKeyDiffs) {
    if (fk.status === 'UNCHANGED') continue;
    const info = fk.source ?? fk.target;
    const to = info?.referencedTable ? ` → \`${info.referencedTable}\`` : '';
    lines.push(`- ${STATUS_WORD[fk.status] ?? fk.status} foreign key \`${fk.name}\`${to}`);
  }

  for (const trigger of diff.triggerDiffs ?? []) {
    if (trigger.status === 'UNCHANGED') continue;
    const name = trigger.source?.name ?? trigger.target?.name ?? trigger.name;
    lines.push(`- ${STATUS_WORD[trigger.status] ?? trigger.status} trigger \`${name}\``);
  }

  return lines;
}

/** `# Schema change report` … in Markdown. Never contains DDL. */
export function buildMigrationReport(
  compare: SchemaCompareResult,
  meta: MigrationReportMeta
): string {
  const when = (meta.generatedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  const changed = compare.tables.filter((t) => t.status !== 'UNCHANGED');

  const out: string[] = [
    '# Schema change report',
    '',
    `**Comparing:** ${meta.originalLabel} → ${meta.targetLabel}`,
  ];
  if (meta.databaseLabel) out.push(`**Database:** ${meta.databaseLabel}`);
  out.push(`**Generated:** ${when} UTC`, '');

  out.push(
    '## Summary',
    '',
    '| Change | Objects |',
    '| --- | ---: |',
    `| Added | ${compare.summary.added} |`,
    `| Changed | ${compare.summary.modified} |`,
    `| Removed | ${compare.summary.removed} |`,
    `| Unchanged | ${compare.summary.unchanged} |`,
    ''
  );

  if (changed.length === 0) {
    out.push('No objects differ between these two versions.', '');
    return out.join('\n');
  }

  out.push('## Objects changed', '', '| Object | Type | Change |', '| --- | --- | --- |');
  for (const table of changed) {
    out.push(
      `| \`${table.tableName}\` | ${table.objectType} | ${STATUS_WORD[table.status] ?? table.status} |`
    );
  }
  out.push('');

  out.push('## Details', '');
  for (const table of changed) {
    out.push(`### ${table.tableName}`, '', `${STATUS_WORD[table.status] ?? table.status} ${table.objectType.toLowerCase()}.`, '');
    const details = objectDetails(table);
    if (details.length > 0) {
      out.push(...details, '');
    } else {
      // A view or routine whose body changed has no child diffs to list, and
      // saying so beats an empty heading that looks like a rendering bug.
      out.push('_No column, index or constraint changes were recorded for this object._', '');
    }
  }

  return out.join('\n');
}

/** Filename-safe slug for the downloaded file. */
export function migrationReportFilename(meta: MigrationReportMeta): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `schema-report-${slug(meta.originalLabel)}-to-${slug(meta.targetLabel)}.md`;
}
