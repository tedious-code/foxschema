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

  it('shows the statement strip for multi-statement SQL', async () => {
    await sql.setSql('SELECT 1 AS n;\nSELECT name FROM customers WHERE id = 1;');
    expect(await sql.statementStripVisible()).toBe(true);
    const strip = await driver.locator('[data-testid="sql-statement-strip"]').innerText();
    expect(strip).toMatch(/#1/);
    expect(strip).toMatch(/#2/);
  });

  it('warns on write statements targeting sqlite (read-only adapter)', async () => {
    await sql.setSql("UPDATE customers SET city = 'X' WHERE id = 1;");
    await sql.run();
    await driver.waitForSelector('[data-testid="sql-write-confirm"]', { timeout: 10_000 });
    expect(await sql.writeConfirmReadonlyWarnVisible()).toBe(true);
    await sql.confirmWriteIfShown();
    await sql.waitForResults();
    const text = (await sql.resultsText()).toLowerCase();
    // better-sqlite3 opens readonly / uses .all() — UPDATE surfaces as a per-cell error.
    expect(text).toMatch(/does not return data|readonly|read-only|only support select|attempt to write/i);
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
