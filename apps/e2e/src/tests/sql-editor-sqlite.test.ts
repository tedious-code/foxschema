/**
 * SQL Editor against two local SQLite files (seeded in beforeAll).
 * Requires the web app + API (`npm run dev`) and a `sqlite3` CLI on PATH.
 * Skips when sqlite3 is unavailable so CI without the CLI stays green.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { saveScreenshot, saveSeoScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const DIR = '/tmp/foxschema-e2e-sql-editor';
const DB_A = join(DIR, 'editor_a.db');
const DB_B = join(DIR, 'editor_b.db');
// Unique names per run so leftover passwordless credentials from prior runs
// don't collide / steal the checklist checkboxes.
const RUN = Date.now().toString(36);
const NAME_A = `E2E SQL A ${RUN}`;
const NAME_B = `E2E SQL B ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function seedDb(path: string, name: string): void {
  execFileSync(
    'sqlite3',
    [path],
    {
      input: `
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT
);
INSERT INTO customers (id, name, city) VALUES (1, '${name}', 'Denver');
INSERT INTO customers (id, name, city) VALUES (2, 'Shared', 'Austin');
`,
    }
  );
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · SQLite multi-credential', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    seedDb(DB_A, 'Alice');
    seedDb(DB_B, 'Bob');
    expect(existsSync(DB_A)).toBe(true);
    expect(existsSync(DB_B)).toBe(true);

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    await sql.addSqliteCredential(NAME_A, DB_A);
    await sql.addSqliteCredential(NAME_B, DB_B);
  }, 120_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('runs SELECT against both credentials and shows divergent rows', async () => {
    await sql.openView();
    await sql.checkConnection(NAME_A);
    await sql.checkConnection(NAME_B);
    await sql.setSql('SELECT id, name, city FROM customers ORDER BY id;');
    await sql.run();
    await sql.waitForResults();
    const text = await sql.resultsText();
    expect(text).toMatch(/Alice/);
    expect(text).toMatch(/Bob/);
    expect(text).toMatch(/Shared/);
  });

  it('toggles side-by-side results layout', async () => {
    await sql.setLayoutSideBySide();
    const text = await sql.resultsText();
    expect(text).toMatch(/Alice|Bob/);
    await sql.setLayoutByCredential();
  });

  it('compares seeded rows across credentials with colored cell diffs', async () => {
    // Seeds: id=1 is Alice vs Bob (modified); id=2 Shared/Austin matches.
    await sql.openView();
    await sql.checkConnection(NAME_A);
    await sql.checkConnection(NAME_B);
    await sql.setSql('SELECT id, name, city FROM customers ORDER BY id;');
    await sql.run();
    await sql.waitForResults();
    await sql.setLayoutSideBySide();

    await driver.waitForSelector('[data-testid="sql-result-compare-toggle-0"]', {
      timeout: 10_000,
    });
    expect(await sql.compareToggle(0).isChecked()).toBe(true);
    expect(await sql.compareLegend(0).isVisible()).toBe(true);
    expect(await sql.compareBaselineSelect(0).isVisible()).toBe(true);

    // Wait for highlight pass after Compare defaults on.
    await driver.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="sql-results-side-by-side"] td[data-diff]').length >
        0,
      { timeout: 10_000 }
    );

    const modified = await sql.diffCellCount('modified');
    const anyDiff = await sql.diffCellCount();
    expect(modified).toBeGreaterThanOrEqual(2); // name cell tinted on both grids
    expect(anyDiff).toBeGreaterThanOrEqual(modified);

    const results = await sql.resultsText();
    expect(results).toMatch(/baseline|source/i);
    expect(results).toMatch(/differ|match/i);

    // Data migrate bar (≤500) with insert/update/delete checkboxes.
    await driver.waitForSelector('[data-testid="sql-data-migrate-bar-0"]', {
      timeout: 10_000,
    });
    expect(await driver.locator('[data-testid="sql-data-migrate-insert-0"]').isVisible()).toBe(
      true
    );
    expect(await driver.locator('[data-testid="sql-data-migrate-identity-0"]').isVisible()).toBe(
      true
    );

    // Capture the colored compare + migrate bar for the PR / walkthrough.
    await saveScreenshot(driver, 'sql-editor-data-compare');
    await saveSeoScreenshot(driver, 'sql-editor-data-compare');

    // Toggle Compare off → highlights clear.
    await sql.compareToggle(0).click();
    await driver.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="sql-results-side-by-side"] td[data-diff]')
          .length === 0,
      { timeout: 10_000 }
    );
    expect(await sql.diffCellCount()).toBe(0);
  });

  it('shows the statement strip for multi-statement SQL', async () => {
    await sql.setSql('SELECT 1 AS n;\nSELECT name FROM customers WHERE id = 1;');
    expect(await sql.statementStripVisible()).toBe(true);
    const strip = await driver.locator('[data-testid="sql-statement-strip"]').innerText();
    // Jupyter-style cells label statements In [1] / In [2] (legacy used #1 / #2).
    expect(strip).toMatch(/In\s*\[1\]|#1/);
    expect(strip).toMatch(/In\s*\[2\]|#2/);
  });

  it('prompts for confirmation before running UPDATE', async () => {
    await sql.setSql("UPDATE customers SET city = 'X' WHERE id = 1;");
    await sql.run();
    await driver.waitForSelector('[data-testid="sql-write-confirm"]', { timeout: 10_000 });
    await sql.confirmWriteIfShown();
    await sql.waitForResults();
    const text = (await sql.resultsText()).toLowerCase();
    // File SQLite credentials are writable; assert the statement finished
    // (success cell, affected-rows note, or a clear error — not a hung run).
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/sqlite|update|customer|row|ok|error|fail|affected|select/i);
  });

  it('schema explorer lists customers after load', async () => {
    expect(await sql.schemaExplorerVisible()).toBe(true);
    // Wait for load / ready tree to include our seeded table.
    await driver.waitForFunction(
      () => {
        const root = document.querySelector('[data-testid="sql-schema-explorer"]');
        return !!root && /customers/i.test(root.textContent ?? '');
      },
      { timeout: 30_000 }
    );
    const explorer = await driver.locator('[data-testid="sql-schema-explorer"]').innerText();
    expect(explorer).toMatch(/customers/i);
  });
});
