/**
 * Database Access Assistant + Utilities → Database Access, against a local
 * SQLite file. No Docker / E2E_* env vars — this is the Access suite that
 * cloud and CI without dialect containers can actually run.
 *
 * SQLite has no GRANT catalog and no SQL users. These cases prove the Access
 * surfaces say so instead of hanging, prompting for a password, or crashing.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { saveScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';
import { AccessPage } from '../pages/AccessPage.js';

const DIR = `/tmp/foxschema-e2e-access-${Date.now().toString(36)}`;
const DB = join(DIR, 'access.db');
const RUN = Date.now().toString(36);
const NAME = `E2E Access SQLite ${RUN}`;

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
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO customers (id, name) VALUES (1, 'Ada');
`,
  });
}

const ready = hasSqlite3();

describe.skipIf(!ready)('Access Assistant · SQLite (cloud)', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;
  let access: AccessPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    seedDb(DB);
    expect(existsSync(DB)).toBe(true);

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);
    access = new AccessPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });
    await sql.addSqliteCredential(NAME, DB);
  }, 120_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('opens Access with every tab', async () => {
    await access.openView();
    expect(await driver.locator('[data-testid="access-view"]').isVisible()).toBe(true);
    for (const tab of ['users', 'builder', 'diff', 'inspector', 'report'] as const) {
      expect(
        await driver.locator(`[data-testid="access-tab-${tab}"]`).isVisible(),
        `missing tab ${tab}`
      ).toBe(true);
    }
    await saveScreenshot(driver, 'access-sqlite-tabs');
  });

  it('User Management says SQLite has no accounts instead of listing users', async () => {
    await access.openTab('users');
    await access.selectConnection('user-connection', NAME);
    await driver.waitForSelector('[data-testid="user-unsupported"]', { timeout: 10_000 });
    const body = await driver.locator('[data-testid="user-management"]').innerText();
    expect(body.toLowerCase()).not.toMatch(/password required|credential not found/);
    expect(await driver.locator('[data-testid="user-unsupported"]').innerText()).toMatch(
      /no database accounts/i
    );
    expect(await driver.locator('[data-testid="user-add-user"]').count()).toBe(0);
    await saveScreenshot(driver, 'access-sqlite-users');
  });

  it('Permission Builder refuses GRANT on SQLite', async () => {
    await access.openTab('builder');
    await access.selectConnection('access-connection', NAME);
    await driver.waitForSelector('[data-testid="access-unsupported"]', { timeout: 10_000 });
    // Copy names the engine's nature ("no grants" / file permissions) — not
    // the old "no GRANT model" line, which sounded like a Fox Schema gap.
    expect(await driver.locator('[data-testid="access-unsupported"]').innerText()).toMatch(
      /no grants/i
    );
    // Assert on the control that offers to build SQL, not on the SQL panel.
    // The panel now lives in a dialog that is closed until asked for, so it is
    // absent on every engine — this assertion would pass even if SQLite were
    // wrongly treated as supported. The Preview SQL button is what the builder
    // only renders when the engine can express grants at all.
    expect(await driver.locator('[data-testid="access-preview-sql"]').count()).toBe(0);
    await saveScreenshot(driver, 'access-sqlite-builder');
  });

  it('Permission Diff refuses a GRANT model on SQLite', async () => {
    await access.openTab('diff');
    await driver.waitForSelector('[data-testid="permission-diff"]', { timeout: 10_000 });
    await access.selectConnection('diff-connection', NAME);
    await driver.waitForSelector('[data-testid="diff-unsupported"]', { timeout: 10_000 });
    expect(await driver.locator('[data-testid="diff-unsupported"]').innerText()).toMatch(
      /no grants/i
    );
    expect(await driver.locator('[data-testid="diff-load-catalog"]').count()).toBe(0);
    await saveScreenshot(driver, 'access-sqlite-diff');
  });

  it('offers no permission reader on SQLite at all', async () => {
    // The inspector used to be its own tab, and this asserted it failed closed
    // on an engine with no GRANT catalog. It now lives inside the permissions
    // screen, driven by that screen's connection — and SQLite never gets that
    // far, because the builder refuses the engine first. The guarantee is
    // stronger than it was: rather than a reader that fails when used, there
    // is no reader to use.
    await access.openTab('builder');
    await access.selectConnection('access-connection', NAME);
    await driver.waitForSelector('[data-testid="access-unsupported"]', { timeout: 10_000 });
    expect(await driver.locator('[data-testid="access-effective"]').count()).toBe(0);
    expect(await driver.locator('[data-testid="inspector-table"]').count()).toBe(0);
    await saveScreenshot(driver, 'access-sqlite-inspector');
  });

  it('Access Report load fails closed on SQLite (no catalog)', async () => {
    await access.openTab('report');
    await access.selectConnection('report-connection', NAME);
    await driver.locator('[data-testid="report-load"]').click();
    await driver.waitForSelector('[data-testid="report-error"]', { timeout: 20_000 });
    expect(await driver.locator('[data-testid="report-error"]').innerText()).toMatch(
      /GRANT\/REVOKE catalog|file- or engine-level|does not support/i
    );
    expect(await driver.locator('[data-testid="report-table"]').count()).toBe(0);
    await saveScreenshot(driver, 'access-sqlite-report');
  });

  it('SQL Editor Database Access utility shows SQLite has no GRANT catalog', async () => {
    await sql.openView();
    await sql.checkConnection(NAME);
    await sql.openDatabaseAccess();
    await sql.selectUtilityConnection(NAME, 'db-access-connection');
    await driver.waitForSelector('[data-testid="db-access-unsupported"]', { timeout: 10_000 });
    expect(await driver.locator('[data-testid="db-access-unsupported"]').innerText()).toMatch(
      /GRANT\/REVOKE catalog|file- or engine-level/i
    );
    // Load would 400; the hint is enough — do not leave a hung spinner.
    expect(await driver.locator('[data-testid="db-access-modal"]').isVisible()).toBe(true);
    await saveScreenshot(driver, 'access-sqlite-db-access-modal');
    await sql.closeDatabaseAccess();
  });
});
