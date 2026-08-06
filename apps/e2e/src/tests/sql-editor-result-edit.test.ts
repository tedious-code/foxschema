/**
 * Edit rows from a SQL Editor query-result grid (single-table SELECT).
 * Requires web app + API and sqlite3 on PATH.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const DIR = '/tmp/foxschema-e2e-sql-result-edit';
const DB = join(DIR, 'result_edit.db');
const RUN = Date.now().toString(36);
const NAME = `E2E Result Edit ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · query result row edit', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    execFileSync('sqlite3', [DB], {
      input: `
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  qty INTEGER
);
INSERT INTO items (id, label, qty) VALUES (1, 'seed', 3);
`,
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
  }, 120_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('adds a row from the result grid and keeps joins read-only', async () => {
    await sql.openView();
    await sql.checkConnection(NAME);
    // Wait for schema so single-table editability can resolve.
    await expect
      .poll(async () => sql.schemaExplorerVisible(), { timeout: 30_000 })
      .toBe(true);

    await sql.setSql('SELECT id, label, qty FROM items ORDER BY id;');
    await sql.run();
    await sql.waitForResults();

    const add = driver.locator('[data-testid="sql-result-0-add"]');
    await expect.poll(async () => add.isVisible(), { timeout: 20_000 }).toBe(true);
    await add.click();

    const form = driver.locator('[data-testid="peek-row-editor"]');
    await form.waitFor({ state: 'visible', timeout: 10_000 });
    await form.locator('[data-testid="peek-row-field-id"]').fill('2');
    await form.locator('[data-testid="peek-row-field-label"]').fill('from-grid');
    await form.locator('[data-testid="peek-row-field-qty"]').fill('9');
    await driver.locator('[data-testid="peek-row-submit"]').click();

    await sql.confirmWriteIfShown();
    await form.waitFor({ state: 'detached', timeout: 15_000 });
    await expect
      .poll(async () => (await sql.resultsText()).toLowerCase(), { timeout: 20_000 })
      .toMatch(/from-grid/);

    await sql.setSql(
      'SELECT a.id, a.label FROM items a JOIN items b ON a.id = b.id;'
    );
    await sql.run();
    await sql.waitForResults();
    await expect
      .poll(async () => driver.locator('[data-testid="sql-result-0-add"]').count(), {
        timeout: 15_000,
      })
      .toBe(0);
    await expect
      .poll(
        async () => driver.locator('[data-testid="sql-result-0-readonly"]').isVisible(),
        { timeout: 10_000 }
      )
      .toBe(true);
  });
});
