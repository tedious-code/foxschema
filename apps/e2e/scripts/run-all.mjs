#!/usr/bin/env node
/**
 * Run all configured dialect E2E tests one by one and print a summary report.
 *
 * A dialect is "configured" when its SOURCE and TARGET env vars are present
 * (loaded from apps/e2e/.env automatically).
 *
 * Usage:
 *   node scripts/run-all.mjs              # headless (default)
 *   HEADLESS=false node scripts/run-all.mjs   # headed (visible Chrome)
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env ────────────────────────────────────────────────────────────────
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ── Dialect registry ─────────────────────────────────────────────────────────
const ALL_DIALECTS = [
  { key: 'postgres',   file: 'src/tests/dialects/postgres.test.ts',   label: 'PostgreSQL'  },
  { key: 'mysql',      file: 'src/tests/dialects/mysql.test.ts',       label: 'MySQL'       },
  { key: 'mariadb',    file: 'src/tests/dialects/mariadb.test.ts',     label: 'MariaDB'     },
  { key: 'sqlserver',  file: 'src/tests/dialects/mssql.test.ts',       label: 'SQL Server'  },
  { key: 'oracle',     file: 'src/tests/dialects/oracle.test.ts',      label: 'Oracle'      },
  { key: 'db2',        file: 'src/tests/dialects/db2.test.ts',         label: 'DB2'         },
  { key: 'sqlite',     file: 'src/tests/dialects/sqlite.test.ts',      label: 'SQLite'      },
  { key: 'azuresql',   file: 'src/tests/dialects/azuresql.test.ts',    label: 'Azure SQL'   },
  { key: 'clickhouse', file: 'src/tests/dialects/clickhouse.test.ts',  label: 'ClickHouse'  },
  { key: 'redshift',   file: 'src/tests/dialects/redshift.test.ts',    label: 'Redshift'    },
];

function isConfigured(key) {
  const prefix = `E2E_${key.toUpperCase()}`;
  return !!(process.env[`${prefix}_SOURCE_HOST`] && process.env[`${prefix}_TARGET_HOST`]);
}

const configured = ALL_DIALECTS.filter((d) => isConfigured(d.key));
const skipped    = ALL_DIALECTS.filter((d) => !isConfigured(d.key));

if (configured.length === 0) {
  console.error('No dialects configured. Set E2E_<DIALECT>_SOURCE_HOST / TARGET_HOST env vars.');
  process.exit(1);
}

// ── Run ──────────────────────────────────────────────────────────────────────
const VITEST = 'npx vitest run --config vitest.config.ts --reporter=verbose';
const HEADED  = process.env.HEADLESS === 'false' ? 'HEADLESS=false ' : '';
const logDir  = join(ROOT, 'logs');
mkdirSync(logDir, { recursive: true });

const results = [];
const bar = '─'.repeat(60);

console.log('\n' + bar);
console.log(`  Fox E2E — running ${configured.length} dialect(s)`);
console.log(bar + '\n');

for (const dialect of configured) {
  const start = Date.now();
  const logFile = join(logDir, `${dialect.key}.log`);
  process.stdout.write(`▶  ${dialect.label.padEnd(12)} `);

  let passed = false;
  let output = '';
  try {
    output = execSync(`${HEADED}${VITEST} ${dialect.file}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000, // 5 min per dialect
      env: { ...process.env },
    }).toString();
    passed = true;
    process.stdout.write('✓  PASS');
  } catch (err) {
    output = (err.stdout ?? '').toString() + '\n' + (err.stderr ?? '').toString();
    passed = false;
    process.stdout.write('✗  FAIL');
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  (${elapsed}s)  → log: logs/${dialect.key}.log`);
  writeFileSync(logFile, output, 'utf8');

  // Extract failing test names + first error line from the log
  const failLines = output.split('\n').filter((l) => l.includes('FAIL') || l.includes('Error') || l.includes('✗'));
  results.push({ ...dialect, passed, elapsed, logFile, failLines });
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + bar);
console.log('  SUMMARY');
console.log(bar);

const passed = results.filter((r) => r.passed);
const failed = results.filter((r) => !r.passed);

for (const r of results) {
  const icon = r.passed ? '✓' : '✗';
  console.log(`  ${icon}  ${r.label.padEnd(12)}  ${r.elapsed}s`);
}

if (skipped.length) {
  console.log(`\n  (skipped — no env vars: ${skipped.map((d) => d.label).join(', ')})`);
}

console.log(`\n  ${passed.length} passed  /  ${failed.length} failed  /  ${skipped.length} skipped`);

// ── Failure detail ───────────────────────────────────────────────────────────
if (failed.length > 0) {
  console.log('\n' + bar);
  console.log('  FAILURE DETAIL');
  console.log(bar);

  for (const r of failed) {
    console.log(`\n  ── ${r.label} ─────────────────────────────`);
    // Print up to 30 most relevant lines from the log
    const lines = readFileSync(r.logFile, 'utf8').split('\n');
    const relevant = lines.filter((l) =>
      /error|fail|expect|received|thrown|timeout|FAIL|✗/i.test(l) && l.trim()
    ).slice(0, 30);
    for (const l of relevant) {
      console.log('  ' + l.trimEnd());
    }
    console.log(`\n  Full log: ${r.logFile}`);
  }
}

console.log('\n' + bar + '\n');
process.exit(failed.length > 0 ? 1 : 0);
