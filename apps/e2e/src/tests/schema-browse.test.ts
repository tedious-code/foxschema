/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Schema Sync → Browse, against a local SQLite file.
 *
 * Browse used to be a mode hiding inside Compare, reachable only by pressing a
 * button on one of Compare's two connection cards. It is its own pane now, so
 * this covers the parts that only exist there: the search box and type filters
 * on the left, and the connection card on the right naming the one database
 * being read.
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

const RUN = Date.now().toString(36);
const DIR = `/tmp/foxschema-e2e-schema-browse-${RUN}`;
const DB = join(DIR, 'browse.db');
const NAME = `E2E Browse ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ready = hasSqlite3();

describe.skipIf(!ready)('Schema Sync · Browse (SQLite)', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    execFileSync('sqlite3', [DB], {
      input: `
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL);
CREATE INDEX idx_customers_email ON customers(email);
CREATE VIEW v_customers AS SELECT id, name FROM customers;
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
    await driver.locator('[data-testid="view-sync-btn"]').click();
    await driver.waitForSelector('[data-testid="sync-pane-switcher"]');
  }, 120_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('offers Browse as its own pane beside Compare and History', async () => {
    expect(await driver.locator('[data-testid="sync-pane-compare-btn"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="sync-pane-browse-btn"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="sync-pane-history-btn"]').isVisible()).toBe(true);
  });

  it('says what it wants before anything is loaded', async () => {
    await driver.locator('[data-testid="sync-pane-browse-btn"]').click();
    const empty = driver.locator('[data-testid="schema-tree-empty"]');
    await empty.waitFor({ state: 'visible', timeout: 15_000 });
    // Not "No Comparison Active" — there is no comparison in this pane.
    expect(await empty.innerText()).toMatch(/Nothing loaded/i);
  });

  it('reads one database from its own one-connection bar', async () => {
    // Browse has no Original/Target and no swap — picking the database is the
    // whole interaction, and it loads on pick.
    // Browse's own bar, with no Original/Target and no swap. Compare keeps its
    // two-sided grid and its own Browse buttons — untouched by this pane.
    expect(await driver.locator('[data-testid="browse-bar"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="source-saved-select"]').count()).toBe(0);

    const select = driver.locator('[data-testid="browse-connection-select"]');
    const option = select.locator('option', { hasText: NAME });
    await option.waitFor({ state: 'attached', timeout: 15_000 });
    await select.selectOption((await option.getAttribute('value'))!);

    await driver.waitForSelector('[data-testid="browse-type-filter"]', { timeout: 30_000 });

    // Left: the search box and the type filters, next to the list they filter.
    expect(await driver.locator('input[placeholder*="Search objects"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="browse-type-TABLE"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="browse-type-VIEW"]').isVisible()).toBe(true);
  }, 120_000);

  it('narrows the tree by type', async () => {
    await driver.locator('[data-testid="browse-type-VIEW"]').click();
    await expect
      .poll(async () => driver.locator('[data-testid="diff-item"]').count(), { timeout: 15_000 })
      .toBe(1);
    expect(await driver.locator('[data-testid="diff-item"]').innerText()).toMatch(/v_customers/i);

    // Back to everything.
    await driver.locator('[data-testid="browse-type-VIEW"]').click();
    await expect
      .poll(async () => driver.locator('[data-testid="diff-item"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(1);
  }, 120_000);

  it('names the database being browsed on the right', async () => {
    // Compare names two connections in the toolbar; Browse has one, and before
    // this it was nowhere on screen.
    const card = driver.locator('[data-testid="browse-connection-card"]');
    if (!(await card.isVisible().catch(() => false))) {
      // A row is selected by default, so clear the selection to reach the
      // empty-detail state that carries the card.
      await driver.locator('input[placeholder*="Search objects"]').fill('zzz-no-such-object');
      await card.waitFor({ state: 'visible', timeout: 15_000 });
    }
    const text = await card.innerText();
    expect(text).toMatch(/SQLITE/i);
    expect(text, text).toMatch(/browse\.db/i);
  }, 120_000);
});
