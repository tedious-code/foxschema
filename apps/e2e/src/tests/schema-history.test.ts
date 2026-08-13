/**
 * Schema Sync → History (Lokee) against a local SQLite file.
 * Covers the new Compare Schema history feature: initial snapshot, table
 * blueprint inspector, type filters, and a second snapshot after a column add.
 *
 * Requires `npm run dev` and `sqlite3` on PATH. Skips when sqlite3 is missing.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';
import { LokeeHistoryPage } from '../pages/LokeeHistoryPage.js';

const RUN = Date.now().toString(36);
const DIR = `/tmp/foxschema-e2e-schema-history-${RUN}`;
const DB = join(DIR, 'history.db');
const NAME = `E2E History ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function seedDb(path: string): void {
  execFileSync('sqlite3', [path], {
    input: `
DROP VIEW IF EXISTS v_customers;
DROP TRIGGER IF EXISTS trg_customers_audit;
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);
CREATE INDEX idx_customers_email ON customers(email);
CREATE VIEW v_customers AS SELECT id, name FROM customers;
CREATE TRIGGER trg_customers_audit AFTER INSERT ON customers BEGIN
  SELECT 1;
END;
INSERT INTO customers (id, name, email) VALUES (1, 'Ada', 'ada@example.com');
`,
  });
}

const ready = hasSqlite3();

describe.skipIf(!ready)('Schema Sync · History (SQLite)', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;
  let history: LokeeHistoryPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    seedDb(DB);
    expect(existsSync(DB)).toBe(true);

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);
    history = new LokeeHistoryPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    await sql.addSqliteCredential(NAME, DB);
    await driver.locator('[data-testid="view-sync-btn"]').click();
    await driver.waitForSelector('[data-testid="sync-pane-switcher"]');
    await history.selectSavedTargetByName(NAME);
  }, 120_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('keeps History inside Schema Sync (no standalone Lokee tab)', async () => {
    expect(await history.hasStandaloneLokeeTab()).toBe(false);
    expect(await driver.locator('[data-testid="sync-pane-history-btn"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="lokee-snapshot-target-btn"]').isVisible()).toBe(true);
  });

  it('takes an initial snapshot of the Target and draws the graph', async () => {
    await history.snapshotTarget();
    const toast = await driver
      .locator('[data-testid="app-toast"]')
      .first()
      .innerText()
      .catch(() => '');
    expect(toast, toast).toMatch(/Snapshot|Captured|No changes/i);
    await history.openHistoryPane();
    await history.selectHistoryDatabaseContaining(RUN);
    await history.waitForGraph();
    expect(await history.versionCount()).toBeGreaterThanOrEqual(1);
    expect(await driver.locator('[data-testid^="rf-object-"]').count()).toBeGreaterThan(0);
  });

  it('opens a table blueprint with columns, indexes and triggers', async () => {
    await history.clickTableNode('customers');
    const text = await history.inspectorText();
    expect(text).toMatch(/email/i);
    expect(await driver.locator('[data-testid="lokee-inspector-columns"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="lokee-inspector-indexes"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="lokee-inspector-triggers"]').isVisible()).toBe(true);
    expect(text).toMatch(/idx_customers_email/i);
    expect(text).toMatch(/trg_customers_audit/i);
  });

  it('exposes view / procedure / function type filters', async () => {
    expect(await history.typeFilterVisible('view')).toBe(true);
    expect(await history.typeFilterVisible('procedure')).toBe(true);
    expect(await history.typeFilterVisible('function')).toBe(true);
    await history.enableType('view');
    await driver.locator('[data-testid^="rf-object-"]').filter({ hasText: 'v_customers' }).first().waitFor({
      timeout: 10_000,
    });
  });

  it('records a new version after a column is added', async () => {
    execFileSync('sqlite3', [DB], {
      input: `ALTER TABLE customers ADD COLUMN phone TEXT;\n`,
    });
    const schema = execFileSync('sqlite3', [DB, '.schema customers'], { encoding: 'utf8' });
    expect(schema).toMatch(/phone/i);

    const before = await history.versionCount();
    await history.snapshotTarget();
    await history.selectHistoryDatabaseContaining(RUN);
    await history.waitForGraph();
    await expect
      .poll(async () => history.versionCount(), { timeout: 20_000 })
      .toBeGreaterThan(before);
    await history.clickTableNode('customers');
    const inspector = await history.inspectorText();
    expect(inspector).toMatch(/phone/i);
    expect(await driver.locator('[data-testid="lokee-inspector-growth"]').isVisible()).toBe(true);
  });
});
