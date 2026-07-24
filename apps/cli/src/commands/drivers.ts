import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import { friendlyError } from '../format/friendlyError';

const require = createRequire(import.meta.url);

const DRIVER_PACKAGES: Record<string, { pkg: string; notes: string }> = {
  db2: {
    pkg: 'ibm_db',
    notes:
      'Large CLI driver. Not available on linux/arm64. Docker image 5nickels/foxschema:latest includes Db2 (linux/amd64).',
  },
  oracle: {
    pkg: 'oracledb',
    notes: 'Thin mode works without Instant Client; thick mode needs Oracle Instant Client installed.',
  },
};

function webWorkspaceRoot(): string {
  try {
    return dirname(require.resolve('@foxschema/web/package.json'));
  } catch {
    throw new Error('Could not locate @foxschema/web — are you in a Fox Schema install?');
  }
}

function tryRequire(id: string): boolean {
  try {
    require.resolve(id);
    return true;
  } catch {
    return false;
  }
}

/** Report which optional/native drivers are resolvable. */
export async function runDriversList(): Promise<void> {
  console.log(chalk.bold('Fox Schema — database drivers'));
  const defaults = [
    ['postgres', 'pg'],
    ['mysql/mariadb', 'mysql2'],
    ['sqlserver', 'mssql'],
    ['sqlite (user DBs)', 'better-sqlite3'],
    ['clickhouse', '@clickhouse/client'],
    ['duckdb', '@duckdb/node-api'],
    ['oracle', 'oracledb'],
    ['db2', 'ibm_db'],
  ] as const;

  for (const [label, id] of defaults) {
    const ok = tryRequire(id);
    const mark = ok ? chalk.green('installed') : chalk.yellow('missing');
    console.log(`  ${label.padEnd(22)} ${mark}  ${chalk.dim(id)}`);
  }
  console.log();
  console.log(chalk.dim('Install opt-in drivers:  foxschema drivers install db2|oracle'));
  console.log(chalk.dim('Docker (includes Db2):   docker pull 5nickels/foxschema:latest'));
}

/**
 * Install an opt-in driver into the web workspace (or global package tree).
 * DB2 is intentionally not a default dependency.
 */
export async function runDriversInstall(name: string): Promise<void> {
  const key = name.trim().toLowerCase();
  const entry = DRIVER_PACKAGES[key];
  if (!entry) {
    throw new Error(
      `Unknown driver "${name}". Supported opt-in installs: ${Object.keys(DRIVER_PACKAGES).join(', ')}`
    );
  }

  if (tryRequire(entry.pkg)) {
    console.log(chalk.green(`${entry.pkg} is already installed.`));
    console.log(chalk.dim(entry.notes));
    return;
  }

  console.log(chalk.bold(`Installing ${entry.pkg}…`));
  console.log(chalk.dim(entry.notes));

  const cwd = webWorkspaceRoot();

  // Prefer installing into the @foxschema/web package directory.
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['install', entry.pkg, '--prefix', cwd], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install ${entry.pkg} failed (exit ${code})`));
    });
  });

  void join(cwd, 'package.json');

  if (!tryRequire(entry.pkg)) {
    console.log(
      chalk.yellow(
        `Install finished but Node cannot resolve ${entry.pkg} from this process yet. ` +
          'Restart your shell / reopen Fox Schema, then run `foxschema doctor`.'
      )
    );
  } else {
    console.log(chalk.green.bold(`✔ ${entry.pkg} installed.`));
  }
}

export async function runDrivers(subcommand: string, name?: string): Promise<void> {
  try {
    if (subcommand === 'list' || subcommand === 'ls') {
      await runDriversList();
      return;
    }
    if (subcommand === 'install' || subcommand === 'add') {
      if (!name) throw new Error('Usage: foxschema drivers install <db2|oracle>');
      await runDriversInstall(name);
      return;
    }
    throw new Error(`Unknown drivers subcommand "${subcommand}". Use list|install.`);
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}
