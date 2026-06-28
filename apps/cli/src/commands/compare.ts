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

const STATUS_COLOR: Record<string, (s: string) => string> = {
  ADDED: chalk.green,
  REMOVED: chalk.red,
  MODIFIED: chalk.yellow,
  UNCHANGED: chalk.dim,
};

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

  const result = await compareModule.compare(sourceTables, targetTables);
  const { added, removed, modified, unchanged } = result.summary;
  const drift = added + removed + modified > 0;

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.ddl) {
    const changed = result.tables.filter((t: TableDiff) => t.status !== 'UNCHANGED');
    if (changed.length === 0) {
      console.log(chalk.dim('-- schemas are identical; no migration needed'));
    } else {
      console.log(sqlGenerator.generateMigrationSql(changed, tgt.dialect));
    }
  } else {
    // table / summary view
    console.log(
      `${chalk.green(`+${added}`)}  ${chalk.red(`-${removed}`)}  ${chalk.yellow(`~${modified}`)}  ${chalk.dim(`=${unchanged}`)}   ${chalk.dim(
        `(${src.dialect} ${src.schema || ''} → ${tgt.schema || ''})`
      )}`
    );
    const changed = result.tables.filter((t: TableDiff) => t.status !== 'UNCHANGED');
    for (const t of changed) {
      const color = STATUS_COLOR[t.status] ?? chalk.white;
      console.log(`  ${color(t.status.padEnd(9))} ${chalk.dim(`[${t.objectType}]`)} ${t.tableName}`);
    }
    if (!drift) console.log(chalk.green('✔ Schemas are identical.'));
  }

  if (drift && opts.fail !== false) process.exitCode = 1;
}
