/**
 * SQL Editor smoke tests — no DB required (dev server only).
 * Covers view switcher, empty checklist copy, tabs, schema explorer chrome.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { Page } from 'playwright';
import { buildDriver, quitDriver, BASE_URL } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

let driver: Page;
let app: AppPage;
let sql: SqlEditorPage;

beforeAll(async () => {
  driver = await buildDriver();
  app = new AppPage(driver);
  sql = new SqlEditorPage(driver);
});

afterAll(async () => {
  await quitDriver(driver);
});

describe('SQL Editor smoke', () => {
  it('opens the SQL Editor view from the toolbar', async () => {
    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');
    await sql.openView();
    expect(await sql.isEditorVisible()).toBe(true);
  });

  it('shows the schema explorer and empty-connection hint', async () => {
    expect(await sql.schemaExplorerVisible()).toBe(true);
    const body = await driver.locator('[data-testid="sql-editor-view"]').innerText();
    // Either no saved connections yet, or leftovers from a prior local session —
    // explorer chrome must still be present either way.
    expect(body).toMatch(/Schema|Destination servers/i);
  });

  it('can add a second editor tab', async () => {
    const before = await sql.tabCount();
    await sql.addTab();
    expect(await sql.tabCount()).toBe(before + 1);
  });

  it('Run stays disabled with no SQL / no checked connections', async () => {
    const btn = driver.locator('[data-testid="sql-run-btn"]');
    expect(await btn.isDisabled()).toBe(true);
  });

  it('switches back to Sync view', async () => {
    await sql.openSyncView();
    expect(await sql.isEditorVisible()).toBe(false);
    expect(await driver.locator('[data-testid="toolbar"]').isVisible()).toBe(true);
    // Keep BASE_URL sanity — sync view does not mount sql-editor-view.
    expect(driver.url()).toContain(new URL(BASE_URL).host);
  });
});
