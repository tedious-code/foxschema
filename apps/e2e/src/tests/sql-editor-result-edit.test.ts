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

const RUN = Date.now().toString(36);
// Per-run path: the backend pools SQLite handles by file path, so reusing one
// path across runs leaves a handle open on the deleted inode and every write
// fails with "attempt to write a readonly database".
const DIR = `/tmp/foxschema-e2e-sql-result-edit-${RUN}`;
const DB = join(DIR, 'result_edit.db');
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
    // id is `INTEGER PRIMARY KEY` — a SQLite rowid alias, so the form disables
    // it as auto-generated. SQLite assigns id=2 on insert.
    expect(await form.locator('[data-testid="peek-row-field-id"]').isDisabled()).toBe(true);
    await form.locator('[data-testid="peek-row-field-label"]').fill('from-grid');
    await form.locator('[data-testid="peek-row-field-qty"]').fill('9');
    await driver.locator('[data-testid="peek-row-submit"]').click();

    await sql.confirmWriteIfShown();
    // Data Peek keeps the form under Safe Mode confirm until the write succeeds;
    // dismiss any leftover form so later steps can reach the editor.
    const formStill = driver.locator('[data-testid="peek-row-editor"]');
    if (await formStill.isVisible().catch(() => false)) {
      await driver.keyboard.press('Escape');
      await formStill.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    }
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
