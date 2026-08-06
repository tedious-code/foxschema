/**
 * SELECT column picker (#173) against a seeded SQLite file.
 *
 * Covers the pieces that only show up with a real editor + schema: opening the
 * picker aliases bare FROM tables, the checkbox list is built from schema
 * columns under those aliases, Select all / Remove all / single toggles write
 * back into the SQL text, and the box closes on outside click or Escape.
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

const DIR = '/tmp/foxschema-e2e-column-picker';
const DB = join(DIR, 'picker.db');
// Unique name per run so leftover credentials don't steal the checkbox.
const RUN = Date.now().toString(36);
const NAME = `E2E Picker ${RUN}`;

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
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS order_items;
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  total REAL
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER,
  sku TEXT,
  qty INTEGER
);
INSERT INTO orders (id, customer_id, total) VALUES (1, 10, 99.5);
INSERT INTO order_items (id, order_id, sku, qty) VALUES (1, 1, 'ABC', 2);
`,
  });
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · SELECT column picker', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    seedDb(DB);
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

    // The picker builds its list from the loaded schema cache.
    await driver.waitForFunction(
      () => {
        const root = document.querySelector('[data-testid="sql-schema-explorer"]');
        return !!root && /order_items/i.test(root.textContent ?? '');
      },
      { timeout: 60_000 }
    );
  }, 180_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('aliases a bare FROM table when the picker opens', async () => {
    await sql.setSql('SELECT * FROM orders');
    await sql.openColumnPicker();
    expect(await sql.columnPickerVisible()).toBe(true);

    const text = await sql.editorText();
    // `orders` is single-word, so the alias is a short stem — capture it rather
    // than pinning the heuristic (unit tests cover the exact letters).
    const alias = /from\s+orders\s+([a-z][a-z0-9]{0,3})\b/i.exec(text)?.[1];
    expect(alias, `no alias added to FROM in: ${text}`).toBeTruthy();
    expect(alias!.length).toBeLessThanOrEqual(4);
    await sql.closeColumnPicker();
  });

  it('lists schema columns qualified by the FROM alias', async () => {
    await sql.setSql('SELECT * FROM orders');
    await sql.openColumnPicker();
    const alias = /from\s+orders\s+([a-z][a-z0-9]{0,3})\b/i.exec(await sql.editorText())?.[1];
    expect(alias).toBeTruthy();

    const labels = await sql.pickerColumnLabels();
    expect(labels).toContain(`${alias}.id`);
    expect(labels).toContain(`${alias}.customer_id`);
    expect(labels).toContain(`${alias}.total`);
    // SELECT * shows as the star state, not per-column checkboxes.
    expect(await sql.pickerStatusText()).toMatch(/SELECT \*/i);
    await sql.closeColumnPicker();
  });

  it('Remove all clears the list and a checkbox adds one column', async () => {
    await sql.setSql('SELECT * FROM orders');
    await sql.openColumnPicker();
    const alias = /from\s+orders\s+([a-z][a-z0-9]{0,3})\b/i.exec(await sql.editorText())?.[1];
    expect(alias).toBeTruthy();

    await sql.pickerRemoveAll();
    expect(await sql.editorText()).not.toMatch(/select\s+\*/i);

    await sql.pickerToggleColumn(`${alias}.total`);
    expect(await sql.editorText()).toMatch(
      new RegExp(`select\\s+${alias}\\.total\\s+from`, 'i')
    );
    expect(await sql.pickerColumnChecked(`${alias}.total`)).toBe(true);

    // Unchecking the same box takes it back out of the SELECT list.
    await sql.pickerToggleColumn(`${alias}.total`);
    expect(await sql.editorText()).not.toMatch(new RegExp(`${alias}\\.total`, 'i'));
    await sql.closeColumnPicker();
  });

  it('Select all (*) puts the star back', async () => {
    await sql.setSql('SELECT * FROM orders');
    await sql.openColumnPicker();
    const alias = /from\s+orders\s+([a-z][a-z0-9]{0,3})\b/i.exec(await sql.editorText())?.[1];
    await sql.pickerRemoveAll();
    await sql.pickerToggleColumn(`${alias}.id`);
    expect(await sql.editorText()).toMatch(new RegExp(`${alias}\\.id`, 'i'));

    await sql.pickerSelectAllStar();
    const text = await sql.editorText();
    expect(text).toMatch(/select\s+\*\s+from/i);
    expect(text).not.toMatch(new RegExp(`select[^;]*${alias}\\.id`, 'i'));
    await sql.closeColumnPicker();
  });

  it('qualifies columns with the alias when FROM names a schema', async () => {
    // Regression: `schema.table alias` used to list columns under the table
    // name, because the alias map was keyed by the qualified name while the
    // schema cache holds the bare one. SQLite accepts `main.` as the schema.
    await sql.setSql('SELECT * FROM main.orders ord');
    await sql.openColumnPicker();
    const labels = await sql.pickerColumnLabels();
    expect(labels).toContain('ord.id');
    expect(labels).toContain('ord.total');
    expect(labels.some((l) => /^orders\./i.test(l))).toBe(false);
    await sql.closeColumnPicker();
  });

  it('uses initials as the alias for a multi-word table', async () => {
    await sql.setSql('SELECT * FROM order_items');
    await sql.openColumnPicker();
    const text = await sql.editorText();
    const alias = /from\s+order_items\s+([a-z][a-z0-9]{0,3})\b/i.exec(text)?.[1];
    expect(alias, `no alias added to FROM in: ${text}`).toBeTruthy();
    expect(alias!.toLowerCase()).toBe('oi');
    expect(await sql.pickerColumnLabels()).toContain('oi.sku');
    await sql.closeColumnPicker();
  });

  it('closes on a click outside the box without changing the SQL', async () => {
    await sql.setSql('SELECT * FROM orders');
    await sql.openColumnPicker();
    expect(await sql.columnPickerVisible()).toBe(true);

    const before = await sql.editorText();
    await sql.clickOutsideColumnPicker();
    await driver
      .locator('[data-testid="sql-select-column-picker"]')
      .waitFor({ state: 'detached', timeout: 5_000 });
    expect(await sql.columnPickerVisible()).toBe(false);
    expect(await sql.editorText()).toBe(before);
  });

  it('closes on Escape', async () => {
    await sql.openColumnPicker();
    expect(await sql.columnPickerVisible()).toBe(true);
    await driver.keyboard.press('Escape');
    await driver
      .locator('[data-testid="sql-select-column-picker"]')
      .waitFor({ state: 'detached', timeout: 5_000 });
    expect(await sql.columnPickerVisible()).toBe(false);
  });
});
