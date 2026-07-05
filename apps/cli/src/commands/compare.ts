import chalk from 'chalk';
import type { TableDiff } from '@foxschema/core';
import { resolveRef } from '../runtime/connectionRef';
import { compareModule, loadScopedTables, parseScope, sqlGenerator } from '../runtime/engine';

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

// Object-type → plural section label (matches the DbObjectType union in core).
const TYPE_LABEL: Record<string, string> = {
  TABLE: 'TABLES',
  VIEW: 'VIEWS',
  MQT: 'MATERIALIZED VIEWS',
  SEQUENCE: 'SEQUENCES',
  TYPE: 'TYPES',
  FUNCTION: 'FUNCTIONS',
  PROCEDURE: 'PROCEDURES',
  TRIGGER: 'TRIGGERS',
  ROLE: 'ROLES',
};
// Canonical section order, used to break ties when two types have the same count.
const TYPE_ORDER = Object.keys(TYPE_LABEL);

// Coloured single-char change marker, and the order changes are listed within a type.
const STATUS_MARK: Record<string, string> = {
  ADDED: chalk.green('+'),
  MODIFIED: chalk.yellow('~'),
  REMOVED: chalk.red('-'),
};
const STATUS_ORDER: Record<string, number> = { MODIFIED: 0, ADDED: 1, REMOVED: 2 };

const RULE_WIDTH = 59;

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

/** Group changed diffs by object type, then print each type as a counted section. */
export function renderGroupedView(changed: TableDiff[]): void {
  const byType = new Map<string, TableDiff[]>();
  for (const t of changed) {
    const list = byType.get(t.objectType) ?? [];
    list.push(t);
    byType.set(t.objectType, list);
  }

  // Sections ordered by size (largest first), ties broken by the canonical type order.
  const sections = [...byType.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]);
  });

  console.log();
  console.log(chalk.bold('Changes by Type'));
  console.log(chalk.dim('─'.repeat(RULE_WIDTH)));

  for (const [type, items] of sections) {
    items.sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        a.tableName.localeCompare(b.tableName)
    );
    console.log();
    console.log(chalk.bold(`${TYPE_LABEL[type] ?? type} (${items.length})`));
    for (const t of items) {
      console.log(`  ${STATUS_MARK[t.status] ?? '·'} ${t.tableName}`);
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
    // Grouped summary view: header, boxed counts, then one section per object type.
    const dialects = src.dialect === tgt.dialect ? src.dialect : `${src.dialect} → ${tgt.dialect}`;
    const route = `${dialects}: ${src.schema || '(default)'} → ${tgt.schema || '(default)'}`;

    console.log();
    console.log(chalk.bold('Fox Compare'));
    console.log(chalk.dim(route));
    console.log();
    console.log(summaryBox(added, removed, modified, unchanged));

    if (!drift) {
      console.log();
      console.log(chalk.green('✔ Schemas are identical.'));
    } else {
      renderGroupedView(result.tables.filter((t: TableDiff) => t.status !== 'UNCHANGED'));
    }
  }

  if (drift && opts.fail !== false) process.exitCode = 1;
}
