/**
 * Runs a `-- @js` cell that imports `@faker-js/faker` in a real browser.
 *
 * Unit tests cover the executor, but not the part that only exists in a built
 * app: faker is fetched on demand (it is too big for the editor's eager
 * chunks), and the cell runs inside a Web Worker. This asserts that path works
 * end to end.
 *
 * Requires the web app + API (`npm run dev`) and a `sqlite3` CLI on PATH.
 * Skips when sqlite3 is unavailable so CI without the CLI stays green.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const DIR = '/tmp/foxschema-e2e-faker-cell';
const DB = join(DIR, 'cells.db');
const RUN = Date.now().toString(36);
const NAME = `E2E Faker ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · faker in a code cell', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    execFileSync('sqlite3', [DB], {
      input: 'CREATE TABLE t (id INTEGER PRIMARY KEY);\nINSERT INTO t (id) VALUES (1);\n',
    });
    expect(existsSync(DB)).toBe(true);

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

  it('imports faker and returns generated rows', async () => {
    await sql.setSql(
      `-- @js\nimport { faker } from '@faker-js/faker';\nfaker.seed(5);\nreturn [{ who: faker.person.firstName() }];\n-- @end`
    );
    await sql.run();
    await sql.waitForResults();
    // The grid appears before the cell finishes: faker is fetched on demand, so
    // the first run pays a chunk load on top of worker startup.
    await expect
      .poll(async () => sql.resultsText(), { timeout: 30_000, interval: 250 })
      .toMatch(/who/i);

    const text = await sql.resultsText();
    // A rejected import would say "not allowlisted"; a missing chunk would be a
    // load error. Either lands in the grid instead of a `who` column.
    expect(text).not.toMatch(/allowlisted|not exported|Failed to fetch/i);
    expect(text).toMatch(/[A-Za-z]{2,}/);
  });
});
