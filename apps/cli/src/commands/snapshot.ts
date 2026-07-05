import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { resolveRef, type RefFlags } from '../runtime/connectionRef';
import { loadScopedTables, parseScope, sqlGenerator } from '../runtime/engine';

/** `snapshot` — dump a schema's objects as DDL (stdout, or --out file). */
export async function runSnapshot(opts: RefFlags & { scope?: string; out?: string }): Promise<void> {
  const ref = await resolveRef(opts);
  const tables = await loadScopedTables(ref.dialect, ref.option, ref.schema, parseScope(opts.scope));
  const header =
    `-- Fox snapshot · ${ref.dialect} · schema ${ref.schema || '(default)'} · ${new Date().toISOString()}\n` +
    `-- ${tables.length} object(s)\n\n`;
  const ddl = header + tables.map((t) => sqlGenerator.generateObjectDdl(t)).join('\n\n') + '\n';

  if (opts.out) {
    writeFileSync(opts.out, ddl);
    console.error(chalk.green(`✔ Wrote ${tables.length} object(s) to ${opts.out}`));
  } else {
    process.stdout.write(ddl);
  }
}
