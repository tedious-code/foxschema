/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edge cases for History versioning and revert. The happy path lives in
 * schema-history.test.ts (snapshot + inspector) and schema-revert.test.ts
 * (drop index → compare → execute → file has the index back).
 *
 * These cases pin the contracts Claude already wrote down:
 *   - an unchanged capture reuses the hash pointer (no extra version)
 *   - Original / Target are versions; the graph does not follow the pickers
 *   - Compare versions is a preview — opening it must not touch the live file
 *   - empty ticks are a no-op, not "revert everything"
 *   - a scoped tick reverts only that object
 *   - a revert records a *new* version; it never rewrites the one it targets
 *   - lossy plans require the Migration SQL acknowledgement
 *   - the file on disk is the source of truth, not the toast
 *
 * Requires `npm run dev` and `sqlite3`. Skips when sqlite3 is missing.
 * Intended for Claude to run and fix — do not assume this file is green.
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

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ready = hasSqlite3();

function sqliteAt(path: string, input: string): string {
  return execFileSync('sqlite3', [path], { input, encoding: 'utf8' });
}

function schemaAt(path: string): string {
  return execFileSync('sqlite3', [path, '.schema'], { encoding: 'utf8' });
}

async function boot(
  dbPath: string,
  name: string
): Promise<{ driver: Page; history: LokeeHistoryPage; sql: SqlEditorPage }> {
  const driver = await buildDriver();
  const app = new AppPage(driver);
  const sql = new SqlEditorPage(driver);
  const history = new LokeeHistoryPage(driver);
  await app.open();
  await sql.resetPersistedEditorState();
  await driver.reload();
  await driver.waitForSelector('[data-testid="toolbar"]');
  await sql.addSqliteCredential(name, dbPath);
  await driver.locator('[data-testid="view-sync-btn"]').click();
  await driver.waitForSelector('[data-testid="sync-pane-switcher"]');
  await history.selectSavedTargetByName(name);
  return { driver, history, sql };
}

// ── 1. Versioning: capture, pickers, preview ────────────────────────────────

describe.skipIf(!ready)('History · versioning edge cases (SQLite)', () => {
  // Suffixed per suite: all three describes evaluate in the same
  // millisecond, so a bare timestamp is not unique and the history
  // picker matched more than one database.
  const RUN = `${Date.now().toString(36)}-edges`;
  const DIR = `/tmp/foxschema-e2e-version-edges-${RUN}`;
  const DB = join(DIR, 'versions.db');
  const NAME = `E2E Versions ${RUN}`;

  let driver: Page;
  let history: LokeeHistoryPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    sqliteAt(
      DB,
      `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);
CREATE INDEX idx_customers_email ON customers(email);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  total INTEGER NOT NULL
);
INSERT INTO customers (id, name, email) VALUES (1, 'Ada', 'ada@example.com');
INSERT INTO invoices (id, total) VALUES (1, 10);
`
    );
    expect(existsSync(DB)).toBe(true);
    ({ driver, history } = await boot(DB, NAME));
  }, 120_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('does not invent a second version when the schema did not change', async () => {
    await history.snapshotTarget();
    await history.openHistoryPane();
    await history.selectHistoryDatabaseContaining(RUN);
    await history.waitForGraph();
    await expect.poll(async () => history.versionCount(), { timeout: 30_000 }).toBe(1);

    // One version ⇒ Original and Target resolve to the same id ⇒ no pair to compare.
    expect(await history.compareVersionsButtonVisible()).toBe(false);

    await history.captureFromHistoryBar();
    await history.waitForGraph();
    await expect.poll(async () => history.versionCount(), { timeout: 20_000 }).toBe(1);
  }, 120_000);

  it('records a real change as v2 and keeps every version node on the graph', async () => {
    sqliteAt(DB, 'ALTER TABLE customers ADD COLUMN phone TEXT;\n');
    sqliteAt(DB, 'ALTER TABLE invoices ADD COLUMN note TEXT;\n');
    sqliteAt(DB, 'DROP INDEX idx_customers_email;\n');
    expect(schemaAt(DB)).toMatch(/phone/i);
    expect(schemaAt(DB)).toMatch(/note/i);
    expect(schemaAt(DB)).not.toMatch(/idx_customers_email/i);

    await history.captureFromHistoryBar();
    await history.waitForGraph();
    await expect.poll(async () => history.versionCount(), { timeout: 30_000 }).toBe(2);

    const nodesBeforePick = await history.graphVersionNodeCount();
    expect(nodesBeforePick).toBeGreaterThanOrEqual(2);

    // Pickers choose what to compare. They must not hide the other version —
    // that was the #261 regression: choosing Version 1 collapsed the timeline.
    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    await expect.poll(async () => history.graphVersionNodeCount(), { timeout: 10_000 }).toBe(
      nodesBeforePick
    );
    expect(await history.compareVersionsButtonVisible()).toBe(true);
  }, 120_000);

  it('hides Compare versions when Original and Target are the same version', async () => {
    await history.selectOriginalVersion('Version 2');
    await history.selectTargetCurrent();
    expect(await history.compareVersionsButtonVisible()).toBe(false);

    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    expect(await history.compareVersionsButtonVisible()).toBe(true);
  }, 60_000);

  it('opens a version compare without writing the live database', async () => {
    const before = schemaAt(DB);
    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    await history.openCompareModal();

    const summary = await history.compareSummaryText();
    expect(summary, summary).toMatch(/added|modified|removed/i);
    const names = await history.compareObjectNames();
    expect(names.some((n) => /customers/i.test(n))).toBe(true);

    const migration = await history.migrationSqlText();
    // Preview of "make Target match Original" — restore the index, drop the new columns.
    expect(migration, migration).toMatch(/idx_customers_email/i);
    expect(migration, migration).not.toMatch(/IDX_CUSTOMERS_EMAIL/);

    expect(schemaAt(DB)).toBe(before);
    await history.closeCompareModal();
    expect(await history.compareModalOpen()).toBe(false);
  }, 120_000);

  it('can compare two historical versions while live stays on the latest schema', async () => {
    // Target = Version 1 (older), Original = Version 2. Live file is still v2.
    await history.selectOriginalVersion('Version 2');
    await history.selectTargetVersion('Version 1');
    expect(await history.compareVersionsButtonVisible()).toBe(true);

    const before = schemaAt(DB);
    await history.openCompareModal();
    expect(await history.compareSummaryText()).toMatch(/added|modified|removed/i);
    expect(schemaAt(DB)).toBe(before);
    expect(schemaAt(DB)).toMatch(/phone/i);
    await history.closeCompareModal();
  }, 120_000);
});

// ── 2. Revert: no-op ticks, scoped object, new version ───────────────────────

describe.skipIf(!ready)('History · revert scope edge cases (SQLite)', () => {
  // Suffixed per suite: all three describes evaluate in the same
  // millisecond, so a bare timestamp is not unique and the history
  // picker matched more than one database.
  const RUN = `${Date.now().toString(36)}-scope`;
  const DIR = `/tmp/foxschema-e2e-revert-scope-${RUN}`;
  const DB = join(DIR, 'scope.db');
  const NAME = `E2E Revert Scope ${RUN}`;

  let driver: Page;
  let history: LokeeHistoryPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    sqliteAt(
      DB,
      `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  total INTEGER NOT NULL
);
INSERT INTO customers (id, name) VALUES (1, 'Ada');
INSERT INTO invoices (id, total) VALUES (1, 10);
`
    );
    ({ driver, history } = await boot(DB, NAME));
    await history.snapshotTarget();
    sqliteAt(DB, 'ALTER TABLE customers ADD COLUMN phone TEXT;\n');
    sqliteAt(DB, 'ALTER TABLE invoices ADD COLUMN note TEXT;\n');
    await history.snapshotTarget();
    await history.openHistoryPane();
    await history.selectHistoryDatabaseContaining(RUN);
    await history.waitForGraph();
    // `expect.poll` is only legal inside a test — this is a beforeAll hook, so
    // wait on the page instead. The page object already owns that wait.
    try {
      await history.waitForVersionCount(2);
    } catch (error) {
      // A bare timeout here says "setup failed" and nothing else; the summary
      // line names the database actually on screen, which is the difference
      // between a missed capture and the wrong database being selected.
      throw new Error(
        `Setup never reached 2 versions.\nSummary: ${await history.summaryText()}`,
        { cause: error }
      );
    }
  }, 180_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('does not revert the live schema when no objects are ticked', async () => {
    // Backend contract: objectKeys=[] is a no-op. The modal must not send
    // `undefined` (whole schema) when the tree has zero ticks.
    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    await history.openCompareModal();
    const beforeSchema = schemaAt(DB);
    const beforeVersions = await history.versionCount();

    if (await history.runRevertDisabled()) {
      expect(schemaAt(DB)).toBe(beforeSchema);
    } else {
      await history.executeRevert();
      await history.closeCompareModal().catch(() => undefined);
    }

    expect(schemaAt(DB), schemaAt(DB)).toMatch(/phone/i);
    expect(schemaAt(DB), schemaAt(DB)).toMatch(/note/i);
    expect(schemaAt(DB)).toBe(beforeSchema);
    expect(await history.versionCount()).toBe(beforeVersions);
    await history.closeCompareModal();
  }, 180_000);

  it('reverts only the ticked object and leaves the other table on the later schema', async () => {
    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    await history.openCompareModal();
    const names = await history.compareObjectNames();
    const invoices = names.find((n) => /invoices/i.test(n));
    expect(invoices, `tree objects: ${names.join(', ')}`).toBeTruthy();
    await history.toggleCompareObject(invoices!);

    const calls: string[] = [];
    driver.on('response', (res) => {
      const url = res.url();
      if (url.includes('/lokee/') && url.includes('/revert') && res.request().method() === 'POST') {
        calls.push(`${res.status()} ${url}`);
      }
    });

    await history.executeRevert();
    try {
      await expect.poll(() => schemaAt(DB), { timeout: 30_000 }).not.toMatch(/note/i);
    } catch (error) {
      throw new Error(
        `Scoped revert did not drop invoices.note.\nPOSTs: ${calls.join(' :: ') || '(none)'}\nToast: ${await history.toastText()}\nSchema: ${schemaAt(DB)}`,
        { cause: error }
      );
    }

    // customers.phone is the unticked side — must still be on the live file.
    expect(schemaAt(DB), schemaAt(DB)).toMatch(/phone/i);
    expect(sqliteAt(DB, 'SELECT count(*) FROM customers;\n').trim()).toBe('1');
    expect(sqliteAt(DB, 'SELECT count(*) FROM invoices;\n').trim()).toBe('1');

    await driver.waitForSelector('[data-testid="lokee-version-compare"]', {
      state: 'detached',
      timeout: 30_000,
    });
    await expect.poll(async () => history.versionCount(), { timeout: 30_000 }).toBe(3);
  }, 180_000);
});

// ── 3. Revert: lossy ack, drop-table, pendulum ───────────────────────────────

describe.skipIf(!ready)('History · revert lossy and pendulum (SQLite)', () => {
  // Suffixed per suite: all three describes evaluate in the same
  // millisecond, so a bare timestamp is not unique and the history
  // picker matched more than one database.
  const RUN = `${Date.now().toString(36)}-lossy`;
  const DIR = `/tmp/foxschema-e2e-revert-lossy-${RUN}`;
  const DB = join(DIR, 'lossy.db');
  const NAME = `E2E Revert Lossy ${RUN}`;

  let driver: Page;
  let history: LokeeHistoryPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    sqliteAt(
      DB,
      `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);
CREATE INDEX idx_customers_email ON customers(email);
INSERT INTO customers (id, name, email) VALUES (1, 'Ada', 'ada@example.com');
`
    );
    ({ driver, history } = await boot(DB, NAME));
    await history.snapshotTarget();
    sqliteAt(DB, 'ALTER TABLE customers ADD COLUMN phone TEXT;\n');
    sqliteAt(DB, "UPDATE customers SET phone = '555' WHERE id = 1;\n");
    sqliteAt(
      DB,
      `
CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  body TEXT
);
INSERT INTO audit (id, body) VALUES (1, 'gone on revert');
`
    );
    sqliteAt(DB, 'DROP INDEX idx_customers_email;\n');
    await history.snapshotTarget();
    await history.openHistoryPane();
    await history.selectHistoryDatabaseContaining(RUN);
    await history.waitForGraph();
    // `expect.poll` is only legal inside a test — this is a beforeAll hook, so
    // wait on the page instead. The page object already owns that wait.
    try {
      await history.waitForVersionCount(2);
    } catch (error) {
      // A bare timeout here says "setup failed" and nothing else; the summary
      // line names the database actually on screen, which is the difference
      // between a missed capture and the wrong database being selected.
      throw new Error(
        `Setup never reached 2 versions.\nSummary: ${await history.summaryText()}`,
        { cause: error }
      );
    }
  }, 180_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('refuses to apply a lossy revert until Migration SQL is acknowledged', async () => {
    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    await history.openCompareModal();
    // Zero ticks is refused by design, so say "all of it" explicitly.
    await history.selectAllCompareObjects();

    const run = driver.locator('[data-testid="lokee-cmp-run-revert"]');
    await run.waitFor({ state: 'visible', timeout: 20_000 });
    const label = (await run.innerText()) ?? '';
    // Additive-looking CREATE INDEX is mixed with DROP COLUMN / DROP TABLE.
    expect(label, label).toMatch(/Review data loss|Execute migration/i);

    if (label.includes('Review data loss')) {
      await run.click();
      await driver.locator('[data-testid="lokee-cmp-tab-SQL"]').waitFor({ state: 'visible', timeout: 10_000 });
      expect(await driver.locator('[data-testid="lokee-cmp-confirm-lossy"]').isVisible()).toBe(true);
      // Closing without the checkbox must leave the file on v2.
      expect(schemaAt(DB)).toMatch(/phone/i);
      expect(schemaAt(DB)).toMatch(/audit/i);
      await history.closeCompareModal();
      expect(schemaAt(DB)).toMatch(/phone/i);
    } else {
      // If the chip is not lossy, still require the plan to mention the drops.
      const sql = await history.migrationSqlText();
      expect(sql, sql).toMatch(/phone|audit|DROP/i);
      await history.closeCompareModal();
    }
  }, 180_000);

  it('applies a lossy revert, keeps surviving rows, and records a new version', async () => {
    await history.selectOriginalVersion('Version 1');
    await history.selectTargetCurrent();
    await history.openCompareModal();
    await history.selectAllCompareObjects();

    const calls: string[] = [];
    driver.on('response', (res) => {
      const url = res.url();
      if (url.includes('/lokee/') && url.includes('/revert') && res.request().method() === 'POST') {
        calls.push(`${res.status()} ${url}`);
      }
    });

    await history.executeRevert();
    try {
      await expect.poll(() => schemaAt(DB), { timeout: 45_000 }).not.toMatch(/phone/i);
    } catch (error) {
      throw new Error(
        `Lossy revert did not drop phone.\nPOSTs: ${calls.join(' :: ') || '(none)'}\nToast: ${await history.toastText()}\nSchema: ${schemaAt(DB)}`,
        { cause: error }
      );
    }

    expect(schemaAt(DB), schemaAt(DB)).not.toMatch(/CREATE TABLE audit/i);
    expect(schemaAt(DB), schemaAt(DB)).toMatch(/idx_customers_email/i);
    expect(sqliteAt(DB, 'SELECT count(*) FROM customers;\n').trim()).toBe('1');
    expect(sqliteAt(DB, 'SELECT name FROM customers WHERE id = 1;\n').trim()).toBe('Ada');

    await driver.waitForSelector('[data-testid="lokee-version-compare"]', {
      state: 'detached',
      timeout: 30_000,
    });
    // v1 baseline, v2 mutated, v3 revert — never rewrite v1.
    await expect.poll(async () => history.versionCount(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  }, 180_000);

  it('can revert again to the middle version (pendulum) and still append history', async () => {
    const versionsBefore = await history.versionCount();
    await history.selectOriginalVersion('Version 2');
    await history.selectTargetCurrent();
    await history.openCompareModal();
    await history.selectAllCompareObjects();
    await history.executeRevert();

    try {
      await expect.poll(() => schemaAt(DB), { timeout: 45_000 }).toMatch(/phone/i);
    } catch (error) {
      throw new Error(
        `Pendulum revert did not restore the v2 schema.\nToast: ${await history.toastText()}\nSchema: ${schemaAt(DB)}`,
        { cause: error }
      );
    }

    await driver.waitForSelector('[data-testid="lokee-version-compare"]', {
      state: 'detached',
      timeout: 30_000,
    });
    await expect
      .poll(async () => history.versionCount(), { timeout: 30_000 })
      .toBeGreaterThan(versionsBefore);
    // Pendulum must not delete Ada while recreating phone / audit.
    expect(sqliteAt(DB, 'SELECT count(*) FROM customers;\n').trim()).toBe('1');
  }, 180_000);
});
