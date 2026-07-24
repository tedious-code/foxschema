import chalk from 'chalk';
import { createRequire } from 'node:module';
import { CompareModule, SqlGeneratorModule } from '@foxschema/core';
import { readConfig, CONFIG_DIR, CONFIG_FILE } from '../runtime/config';
import { getDek } from '../runtime/keyring';
import { friendlyError } from '../format/friendlyError';
import { DEFAULT_UI_PORT, LOCAL_KEY_FILE, PID_FILE, DATA_DIR } from '../runtime/paths';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function driverStatus(id: string): string {
  try {
    require.resolve(id);
    return chalk.green('yes');
  } catch {
    return chalk.yellow('no');
  }
}

async function uiServerStatus(port: number): Promise<string> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return chalk.yellow(`port ${port} responded ${res.status}`);
    return chalk.green(`running on http://localhost:${port}`);
  } catch {
    return chalk.dim(`not running (default port ${port})`);
  }
}

/** Environment + engine-wiring + setup + UI/driver diagnostics. */
export async function runDoctor(): Promise<void> {
  const c = readConfig();
  console.log(chalk.bold('Fox Schema — doctor'));
  console.log(`  node             ${process.version}`);
  console.log(`  platform         ${process.platform}/${process.arch}`);
  console.log(`  config dir       ${CONFIG_DIR}`);
  console.log(`  config file      ${CONFIG_FILE}`);
  console.log(`  data dir         ${DATA_DIR}`);
  console.log(
    `  setup complete   ${c.setupComplete ? chalk.green('yes') : chalk.yellow('no — run `foxschema setup` or `foxschema open`')}`
  );
  if (c.email) {
    const hasKey = process.env.FOXSCHEMA_KEY ? true : !!safe(() => getDek(c.email));
    console.log(`  bound email      ${c.email}`);
    console.log(`  key reachable    ${hasKey ? chalk.green('yes') : chalk.red('no')}`);
  } else if (existsSync(LOCAL_KEY_FILE)) {
    console.log(`  local key file   ${chalk.green('yes')} ${chalk.dim(LOCAL_KEY_FILE)}`);
  }
  console.log(
    `  db engine        ${c.dbEngine}${c.dbEngine === 'sqlite' ? ` · ${c.dbPath || '(default)'}` : c.dbUrl ? ' · (url set)' : ''}`
  );

  let managedPid = '';
  try {
    managedPid = readFileSync(PID_FILE, 'utf8').trim();
  } catch {
    managedPid = '';
  }
  console.log(`  ui lock pid      ${managedPid || chalk.dim('(none)')}`);
  console.log(`  ui server        ${await uiServerStatus(DEFAULT_UI_PORT)}`);

  const coreModulesOk = typeof CompareModule === 'function' && typeof SqlGeneratorModule === 'function';
  let core: string;
  try {
    const mod = await import('@foxschema/core');
    core = chalk.green(`loaded (${Object.keys(mod).length} exports)`);
  } catch (e) {
    core = chalk.red(`failed: ${friendlyError(e)}`);
  }
  console.log(`  @foxschema/core  ${core} ${coreModulesOk ? chalk.green('(modules ok)') : chalk.red('(modules missing)')}`);

  console.log(chalk.bold('\nDrivers'));
  console.log(`  pg                 ${driverStatus('pg')}`);
  console.log(`  mysql2             ${driverStatus('mysql2')}`);
  console.log(`  mssql              ${driverStatus('mssql')}`);
  console.log(`  better-sqlite3     ${driverStatus('better-sqlite3')}`);
  console.log(`  oracledb           ${driverStatus('oracledb')}`);
  console.log(`  @clickhouse/client ${driverStatus('@clickhouse/client')}`);
  console.log(`  @duckdb/node-api   ${driverStatus('@duckdb/node-api')}`);
  console.log(`  ibm_db (DB2)       ${driverStatus('ibm_db')} ${chalk.dim('(optional dep — also in Docker latest)')}`);
  console.log();
  console.log(chalk.dim('Tip: `foxschema` opens the UI at http://localhost:3210'));
}
