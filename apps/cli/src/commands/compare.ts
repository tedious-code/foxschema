import chalk from 'chalk';
import type { TableDiff } from '@foxschema/core';
import { resolveRef } from '../runtime/connectionRef';
import { compareModule, loadScopedTables, parseScope, sqlGenerator } from '../runtime/engine';
import {
  TYPE_LABEL,
  groupByType,
  sortSections,
  sortByStatusThenName,
  countByStatus,
  describeColumn,
  describeIndex,
  describeFk,
  describeTrigger,
} from '../format/diffPresentation';

export interface CompareOptions {
  source?: string;
  target?: string;
  sourceSchema?: string;
  targetSchema?: string;
  scope?: string;
  json?: boolean;
  ddl?: boolean;
  fail?: boolean; // commander: --no-fail sets this false
}

// Coloured single-char change marker for the line-CLI's plain-text output.
const STATUS_MARK: Record<string, string> = {
  ADDED: chalk.green('+'),
  MODIFIED: chalk.yellow('~'),
  REMOVED: chalk.red('-'),
};

/** A boxed summary line: `┌─ +16 Added  ~7 Modified  -1 Removed  =2 Unchanged ─┐`. */
export function summaryBox(added: number, removed: number, modified: number, unchanged: number): string {
  const segs = [
    { plain: `+${added} Added`, colored: chalk.green(`+${added} Added`) },
    { plain: `~${modified} Modified`, colored: chalk.yellow(`~${modified} Modified`) },
    { plain: `-${removed} Removed`, colored: chalk.red(`-${removed} Removed`) },
    { plain: `=${unchanged} Unchanged`, colored: chalk.dim(`=${unchanged} Unchanged`) },
  ];
  const gap = '   ';
  // Width is measured on the plain text — ANSI colour codes are zero-width in the terminal.
  const inner = segs.map((s) => s.plain).join(gap).length + 2;
  const body = ` ${segs.map((s) => s.colored).join(gap)} `;
  return [`┌${'─'.repeat(inner)}┐`, `│${body}│`, `└${'─'.repeat(inner)}┘`].join('\n');
}

/** `label: N added, N modified, N removed, N unchanged` — omits zero counts. */
function formatCounts(counts: Record<string, number>): string {
  const parts: string[] = [];
  if (counts.ADDED) parts.push(chalk.green(`${counts.ADDED} added`));
  if (counts.MODIFIED) parts.push(chalk.yellow(`${counts.MODIFIED} modified`));
  if (counts.REMOVED) parts.push(chalk.red(`${counts.REMOVED} removed`));
  if (counts.UNCHANGED) parts.push(chalk.dim(`${counts.UNCHANGED} unchanged`));
  return parts.join(', ');
}

/** One indented sub-tree line per changed item (columns/indexes/FKs/triggers). Returns whether anything was printed. */
function renderSubItems<T extends { status: string; name: string }>(
  title: string,
  items: T[] | undefined,
  describe: (item: T) => string
): boolean {
  const changed = (items ?? []).filter((i) => i.status !== 'UNCHANGED');
  if (changed.length === 0) return false;
  console.log(`    ${chalk.dim(title)}`);
  for (const item of changed) {
    const desc = describe(item);
    console.log(`      ${STATUS_MARK[item.status] ?? '·'} ${item.name}${desc ? chalk.dim(`  ${desc}`) : ''}`);
  }
  return true;
}

/**
 * Tree view: one section per object type (`TABLES: 3 added, 1 modified, 12
 * unchanged`), one line per changed object, and — for MODIFIED tables/views —
 * an indented drill-down into exactly what changed (columns, indexes, FKs,
 * triggers), each shown as an old → new description.
 */
export function renderTreeView(allTables: TableDiff[]): void {
  const changed = allTables.filter((t) => t.status !== 'UNCHANGED');
  const changedByType = groupByType(changed);
  const totalByType = groupByType(allTables);
  const sections = sortSections([...changedByType.entries()]);

  for (const [type, items] of sections) {
    const counts = countByStatus(totalByType.get(type) ?? items);
    console.log();
    console.log(chalk.bold(`${TYPE_LABEL[type] ?? type}: ${formatCounts(counts)}`));
    for (const t of sortByStatusThenName(items)) {
      console.log(`  ${STATUS_MARK[t.status] ?? '·'} ${t.tableName}`);
      if (t.status === 'MODIFIED') {
        const shownAny = [
          renderSubItems('columns', t.columnDiffs, describeColumn),
          renderSubItems('indexes', t.indexDiffs, describeIndex),
          renderSubItems('foreign keys', t.foreignKeyDiffs, describeFk),
          renderSubItems('triggers', t.triggerDiffs, describeTrigger),
        ].some(Boolean);
        // Views/functions/procedures etc. have no column-level model — a MODIFIED
        // status there means the object's definition changed, with nothing more
        // granular to show.
        if (!shownAny) console.log(`    ${chalk.dim('(definition changed)')}`);
      }
    }
  }
}

/** `compare` — diff two schemas. Exit 0 = identical, 1 = drift (for CI). */
export async function runCompare(opts: CompareOptions): Promise<void> {
  if (!opts.source || !opts.target) {
    throw new Error('Both --source and --target are required (a saved connection name/id).');
  }
  const scope = parseScope(opts.scope);
  const src = await resolveRef({ connection: opts.source, schema: opts.sourceSchema });
  const tgt = await resolveRef({ connection: opts.target, schema: opts.targetSchema });

  const [sourceTables, targetTables] = await Promise.all([
    loadScopedTables(src.dialect, src.option, src.schema, scope),
    loadScopedTables(tgt.dialect, tgt.option, tgt.schema, scope),
  ]);

  // Cross-dialect aware: passing both dialects lets equivalent native types
  // (e.g. MySQL int ≡ Postgres integer) compare equal and lets generated DDL
  // translate source types into the target dialect.
  const mapping = {
    sourceSchema: src.schema,
    targetSchema: tgt.schema,
    sourceDialect: src.dialect,
    targetDialect: tgt.dialect,
  };

  const result = await compareModule.compare(sourceTables, targetTables, {
    source: src.dialect,
    target: tgt.dialect,
  });
  const { added, removed, modified, unchanged } = result.summary;
  const drift = added + removed + modified > 0;

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.ddl) {
    const changed = result.tables.filter((t: TableDiff) => t.status !== 'UNCHANGED');
    if (changed.length === 0) {
      console.log(chalk.dim('-- schemas are identical; no migration needed'));
    } else {
      console.log(sqlGenerator.generateMigrationSql(changed, tgt.dialect, mapping));
    }
  } else {
    // Tree view: header, boxed counts, then one drill-down section per object type.
    const dialectNote = src.dialect === tgt.dialect ? '' : chalk.dim(` (${src.dialect} → ${tgt.dialect})`);

    console.log();
    console.log(chalk.bold(`Schema ${src.schema || '(default)'} → ${tgt.schema || '(default)'}`) + dialectNote);
    console.log();
    console.log(summaryBox(added, removed, modified, unchanged));

    if (!drift) {
      console.log();
      console.log(chalk.green('✔ Schemas are identical.'));
    } else {
      renderTreeView(result.tables);
    }
  }

  if (drift && opts.fail !== false) process.exitCode = 1;
}
