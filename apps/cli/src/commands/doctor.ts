import chalk from 'chalk';
import { CompareModule, SqlGeneratorModule } from '@foxschema/core';
import { readConfig, CONFIG_DIR, CONFIG_FILE } from '../runtime/config';
import { getDek } from '../runtime/keyring';

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Environment + engine-wiring + setup diagnostics. */
export async function runDoctor(): Promise<void> {
  const c = readConfig();
  console.log(chalk.bold('FoxSchema CLI — doctor'));
  console.log(`  node             ${process.version}`);
  console.log(`  config dir       ${CONFIG_DIR}`);
  console.log(`  config file      ${CONFIG_FILE}`);
  console.log(
    `  setup complete   ${c.setupComplete ? chalk.green('yes') : chalk.yellow('no — run `foxschema setup`')}`
  );
  if (c.email) {
    const hasKey = process.env.FOXSCHEMA_KEY ? true : !!safe(() => getDek(c.email));
    console.log(`  bound email      ${c.email}`);
    console.log(`  key reachable    ${hasKey ? chalk.green('yes') : chalk.red('no')}`);
  }
  console.log(
    `  db engine        ${c.dbEngine}${c.dbEngine === 'sqlite' ? ` · ${c.dbPath || '(default)'}` : c.dbUrl ? ' · (url set)' : ''}`
  );

  const coreModulesOk = typeof CompareModule === 'function' && typeof SqlGeneratorModule === 'function';
  let core: string;
  try {
    const mod = await import('@foxschema/core');
    core = chalk.green(`loaded (${Object.keys(mod).length} exports)`);
  } catch (e) {
    core = chalk.red(`failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`  @foxschema/core   ${core} ${coreModulesOk ? chalk.green('(modules ok)') : chalk.red('(modules missing)')}`);
}
