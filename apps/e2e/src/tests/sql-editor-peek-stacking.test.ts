/**
 * Data Peek stacks above the results it was opened from.
 *
 * Four body-level portals share one z-axis here, and nothing but the numbers
 * keeps them in order:
 *
 *   60  ResultsPanel fullscreen
 *   70  DataPeekPanel
 *   95  PeekRowEditor
 *  100  .modal-overlay (WriteConfirmDialog)
 *
 * Data Peek used to be 50. The fullscreen results carry the foreign-key cells
 * whose own footer reads "click one to open Data Peek (related rows)", so
 * clicking one mounted the panel *behind* the overlay — the click looked
 * ignored, and the invisible panel then swallowed the next one. Reading the
 * class names cannot catch that; only a real browser can say which element is
 * actually on top.
 *
 * Requires the web app + API (`npm run dev`) and a `sqlite3` CLI on PATH.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const RUN = Date.now().toString(36);
// Per-run directory: the backend pools SQLite handles by file path, so reusing
// one across runs writes through a handle pointing at a deleted inode.
const DIR = `/tmp/foxschema-e2e-peek-stack-${RUN}`;
const DB = join(DIR, 'stack.db');
const NAME = `E2E Peek Stack ${RUN}`;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The topmost element at the centre of the screen, and whether `sel` owns it. */
async function ownsScreenCentre(driver: Page, sel: string): Promise<boolean> {
  return driver.evaluate((s) => {
    const el = document.querySelector(s);
    const top = document.elementFromPoint(
      Math.round(window.innerWidth / 2),
      Math.round(window.innerHeight / 2)
    );
    return !!(el && top && el.contains(top));
  }, sel);
}

describe.skipIf(!hasSqlite3())('SQL Editor · Data Peek stacking', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    execFileSync('sqlite3', [DB], {
      input: `
PRAGMA foreign_keys = ON;
CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT);
CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));
INSERT INTO parent (id, label) VALUES (1, 'a'), (2, 'b');
INSERT INTO child (id, parent_id) VALUES (1, 1), (2, 2);
`,
    });

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

  it('opens Data Peek on top when the results are fullscreen', async () => {
    await sql.setSql('SELECT id, parent_id FROM child ORDER BY id;');
    await sql.run();
    await sql.waitForResults();
    await driver.waitForSelector('[data-testid^="grid-fk-link-"]', { timeout: 20_000 });

    // Either results layout offers a maximise control; take whichever rendered.
    await driver.locator('[data-testid*="maximize"]').first().click();
    await driver.waitForSelector('[role="dialog"][aria-label*="fullscreen" i]', {
      timeout: 10_000,
    });

    await driver.locator('[data-testid^="grid-fk-link-"]').first().click();
    await driver.waitForSelector('[data-testid="data-peek"]', { timeout: 20_000 });

    expect(
      await ownsScreenCentre(driver, '[data-testid="data-peek"]'),
      'Data Peek mounted underneath the fullscreen results it was opened from'
    ).toBe(true);

    // Escape belongs to the topmost overlay. Both listen on window, so until
    // the results learned to yield, one Escape closed the peek the reader had
    // just opened *and* the results behind it — leaving them somewhere they
    // never asked to go.
    await driver.keyboard.press('Escape');
    await driver
      .locator('[data-testid="data-peek"]')
      .waitFor({ state: 'detached', timeout: 10_000 });
    expect(
      await driver.locator('[role="dialog"][aria-label*="fullscreen" i]').count(),
      'Escape closed the fullscreen results as well as the peek'
    ).toBeGreaterThan(0);
  }, 120_000);
});
