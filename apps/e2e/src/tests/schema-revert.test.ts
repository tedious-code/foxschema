/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Schema Sync → History → Compare versions → revert, against a local SQLite file.
 *
 * This is the one flow whose correctness cannot be argued from unit tests: the
 * revert plan is built from stored objects, but whether it *lands* depends on
 * the generator, the driver and the live schema agreeing. Everything up to the
 * button was already covered; this drives the button and then reads the file on
 * disk to prove the schema actually moved.
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
const DIR = `/tmp/foxschema-e2e-schema-revert-${RUN}`;
const DB = join(DIR, 'revert.db');
const NAME = `E2E Revert ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sqlite(input: string): string {
  return execFileSync('sqlite3', [DB], { input, encoding: 'utf8' });
}

function schemaText(): string {
  return execFileSync('sqlite3', [DB, '.schema'], { encoding: 'utf8' });
}

const ready = hasSqlite3();

describe.skipIf(!ready)('Schema Sync · History revert (SQLite)', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;
  let history: LokeeHistoryPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    sqlite(`
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);
CREATE INDEX idx_customers_email ON customers(email);
INSERT INTO customers (id, name, email) VALUES (1, 'Ada', 'ada@example.com');
`);
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

  it('records the baseline, then a version with the index dropped', async () => {
    await history.snapshotTarget();

    // The change to undo. Dropping an index is the cleanest case to assert on:
    // reverting it is a pure CREATE, so the plan is safe rather than lossy and
    // the file tells us plainly whether it landed.
    sqlite('DROP INDEX idx_customers_email;\n');
    expect(schemaText()).not.toMatch(/idx_customers_email/i);

    await history.snapshotTarget();
    await history.openHistoryPane();
    await history.selectHistoryDatabaseContaining(RUN);
    await history.waitForGraph();
    await expect.poll(async () => history.versionCount(), { timeout: 30_000 }).toBe(2);
  }, 120_000);

  it('shows the reverse DDL before anything is applied', async () => {
    await history.selectOriginalVersion('Version 1');
    await history.openCompareModal();

    // The tree is the shared SchemaDiffTree; the blueprint is SchemaBlueprint.
    expect(await driver.locator('[data-testid="lokee-cmp-summary"]').isVisible()).toBe(true);
    expect(await driver.locator('[data-testid="schema-blueprint"]').isVisible()).toBe(true);

    const migration = await history.migrationSqlText();
    expect(migration, migration).toMatch(/CREATE INDEX/i);
    expect(migration, migration).toMatch(/idx_customers_email/i);

    // Nothing has run yet — the point of comparing before deciding.
    expect(schemaText()).not.toMatch(/idx_customers_email/i);
  }, 120_000);

  it('applies the revert and records it as a new version', async () => {
    // Record what the button actually sent. A silent no-op and a rejected
    // request look identical from the file system, and toasts expire before a
    // 30s poll finishes — so capture the response rather than infer it.
    const calls: string[] = [];
    driver.on('response', (res) => {
      const url = res.url();
      if (url.includes('/lokee/') && url.includes('/revert') && res.request().method() === 'POST') {
        calls.push(`${res.status()} ${url}`);
        void res
          .text()
          .then((body) => calls.push(`body: ${body.slice(0, 300)}`))
          .catch(() => undefined);
      }
    });

    await history.executeRevert();

    // The file is the source of truth: the index is back. If it is not, the
    // toast carries the driver's reason — without it this failure is just
    // "nothing happened", which is the least actionable thing a test can say.
    try {
      await expect
        .poll(() => schemaText(), { timeout: 30_000 })
        .toMatch(/idx_customers_email/i);
    } catch (error) {
      throw new Error(
        `Revert did not reach the database.\nPOSTs: ${calls.join(' :: ') || '(none)'}\nToast: ${await history.toastText()}\nSchema: ${schemaText()}`,
        { cause: error }
      );
    }

    // A revert is itself a migration, so history gains a version for it rather
    // than rewriting the one it reverted to.
    await driver.waitForSelector('[data-testid="lokee-version-compare"]', {
      state: 'detached',
      timeout: 30_000,
    });
    await expect
      .poll(async () => history.versionCount(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    // The row survived: reverting an index must not rebuild the table.
    const rows = sqlite('SELECT count(*) FROM customers;\n').trim();
    expect(rows).toBe('1');
  }, 180_000);
});
