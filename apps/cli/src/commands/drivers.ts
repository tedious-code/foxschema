import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { friendlyError } from '../format/friendlyError';

const require = createRequire(import.meta.url);

const DRIVER_PACKAGES: Record<string, { pkg: string; pin?: string; notes: string }> = {
  db2: {
    pkg: 'ibm_db',
    pin: '4.0.1',
    notes:
      'Large CLI driver + native build. Needs --foreground-scripts (clidriver download). Not available on linux/arm64. Docker image 5nickels/foxschema:latest includes Db2 (linux/amd64).',
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

function monorepoRootFromWeb(webRoot: string): string | null {
  const candidate = join(webRoot, '..', '..');
  try {
    const pkg = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as {
      workspaces?: unknown;
    };
    if (pkg.workspaces && existsSync(join(candidate, 'apps/web/package.json'))) return candidate;
  } catch {
    /* ignore */
  }
  return null;
}

function tryRequire(id: string): boolean {
  try {
    require.resolve(id);
    require(id);
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

  const webRoot = webWorkspaceRoot();
  const mono = monorepoRootFromWeb(webRoot);
  const spec = entry.pin ? `${entry.pkg}@${entry.pin}` : entry.pkg;

  // ibm_db must land where @foxschema/db can require it (not only apps/web).
  const workspacePkg = entry.pkg === 'ibm_db' ? '@foxschema/db' : '@foxschema/web';
  const prefixRoot =
    entry.pkg === 'ibm_db'
      ? (() => {
          try {
            return dirname(require.resolve('@foxschema/db/package.json'));
          } catch {
            return webRoot;
          }
        })()
      : webRoot;

  // Prefer workspace install in a checkout; otherwise --prefix into the package tree.
  // ibm_db must run install scripts or clidriver never downloads.
  const npmArgs = mono
    ? ['install', spec, '--foreground-scripts', '-w', workspacePkg]
    : ['install', spec, '--foreground-scripts', '--prefix', prefixRoot];
  const cwd = mono ?? prefixRoot;

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', npmArgs, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        npm_config_ignore_scripts: '',
        npm_config_foreground_scripts: 'true',
      },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install ${entry.pkg} failed (exit ${code})`));
    });
  });

  if (!tryRequire(entry.pkg)) {
    console.log(
      chalk.yellow(
        `Install finished but Node cannot resolve ${entry.pkg} from this process yet. ` +
          'Restart your shell / reopen Fox Schema (`foxschema stop && foxschema`), then run `foxschema doctor`.\n' +
          'If it still fails: ensure install scripts ran (unset npm ignore-scripts), Xcode CLT on macOS, ' +
          'and use Docker linux/amd64 when on linux/arm64.'
      )
    );
  } else {
    console.log(chalk.green.bold(`✔ ${entry.pkg} installed.`));
    if (entry.pkg === 'ibm_db') {
      console.log(chalk.dim('Restart Fox Schema if the UI still shows the driver as missing.'));
    }
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
