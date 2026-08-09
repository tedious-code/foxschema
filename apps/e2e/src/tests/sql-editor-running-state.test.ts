/**
 * While a query is in flight the results area must show progress, in either
 * layout. Side-by-side used to render an empty container until the first rows
 * arrived: `stmtCount` is derived from the statements that have already run
 * and from per-run results, and a dispatch resets both — so the loop that
 * draws the "running" placeholders had nothing to iterate over.
 *
 * Requires the web app + API (`npm run dev`) and a `sqlite3` CLI on PATH.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const DIR = '/tmp/foxschema-e2e-running-state';
const DB = join(DIR, 'slow.db');
const RUN = Date.now().toString(36);
const NAME = `E2E Slow ${RUN}`;

/** Roughly a second of work — long enough to observe the in-flight state. */
const SLOW_SQL =
  'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000000) ' +
  'SELECT count(*) AS n FROM c;';

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · in-flight results state', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    execFileSync('sqlite3', [DB], { input: 'CREATE TABLE t (id INTEGER);\n' });

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    await sql.addSqliteCredential(NAME, DB);
    await sql.openView();
    await sql.checkConnection(NAME);
  }, 180_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('shows progress while running in by-credential layout', async () => {
    await sql.setLayoutByCredential();
    await sql.setSql(SLOW_SQL);
    await sql.run();

    // Do not wait for results — assert on the in-flight frame.
    await driver.waitForSelector('[data-testid="sql-results-running"]', { timeout: 10_000 });
    await sql.waitForResults();
  });

  it('shows progress while running in side-by-side layout', async () => {
    await sql.setLayoutSideBySide();
    await sql.setSql(SLOW_SQL);
    await sql.run();

    await driver.waitForSelector('[data-testid="sql-results-running"]', { timeout: 10_000 });
    await sql.waitForResults();
  });

  it('never leaves the results area blank mid-run in side-by-side', async () => {
    await sql.setLayoutSideBySide();
    await sql.setSql(SLOW_SQL);
    await sql.run();

    // Sample the container repeatedly while the query is in flight; it must
    // always carry something for the user to read.
    for (let i = 0; i < 6; i++) {
      const text = await driver.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="sql-results-side-by-side"]'
        ) as HTMLElement | null;
        return el ? (el.innerText ?? '').trim() : null;
      });
      if (text !== null) expect(text.length).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 120));
    }
    await sql.waitForResults();
  });
});
