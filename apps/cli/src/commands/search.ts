import chalk from 'chalk';
import type { TableSchema } from '@foxschema/core';
import { resolveRef, type RefFlags } from '../runtime/connectionRef';
import { loadScopedTables, parseScope } from '../runtime/engine';

interface Match {
  object: string;
  type: string;
  field: 'name' | 'column' | 'index' | 'fk' | 'trigger' | 'definition';
  value: string;
}

/** Search a loaded schema for objects/columns/indexes/FKs/triggers matching `term`. */
function searchTables(tables: TableSchema[], term: string, ignoreCase: boolean): Match[] {
  const needle = ignoreCase ? term.toLowerCase() : term;
  const hit = (s?: string) => !!s && (ignoreCase ? s.toLowerCase() : s).includes(needle);
  const out: Match[] = [];
  for (const t of tables) {
    const name = t.name;
    if (hit(name)) out.push({ object: name, type: t.objectType, field: 'name', value: name });
    for (const c of t.columns ?? []) if (hit(c.name)) out.push({ object: name, type: t.objectType, field: 'column', value: c.name });
    for (const i of t.indices ?? []) if (hit(i.name)) out.push({ object: name, type: t.objectType, field: 'index', value: i.name });
    for (const f of t.foreignKeys ?? []) if (hit(f.name)) out.push({ object: name, type: t.objectType, field: 'fk', value: f.name });
    for (const tr of t.triggers ?? []) if (hit(tr.name)) out.push({ object: name, type: t.objectType, field: 'trigger', value: tr.name });
    if (hit(t.definition)) out.push({ object: name, type: t.objectType, field: 'definition', value: '(in definition)' });
  }
  return out;
}

export async function runSearch(
  term: string,
  opts: RefFlags & { scope?: string; json?: boolean; caseSensitive?: boolean }
): Promise<void> {
  const ref = await resolveRef(opts);
  const tables = await loadScopedTables(ref.dialect, ref.option, ref.schema, parseScope(opts.scope));
  const matches = searchTables(tables, term, !opts.caseSensitive);

  if (opts.json) {
    console.log(JSON.stringify(matches, null, 2));
  } else if (matches.length === 0) {
    console.log(chalk.dim(`No matches for "${term}".`));
  } else {
    for (const m of matches) {
      console.log(`${chalk.bold(m.object)} ${chalk.dim(`[${m.type}]`)} — matched ${chalk.cyan(m.field)}: ${m.value}`);
    }
    console.error(chalk.dim(`\n${matches.length} match(es).`));
  }
  if (matches.length === 0) process.exitCode = 1;
}
