/**
 * Copy-to-clipboard and JSON export for SQL Editor result grids.
 *
 * Runs against one seeded SQLite file so exactly one grid is on screen and the
 * testids are unambiguous. Requires the web app + API (`npm run dev`) and a
 * `sqlite3` CLI on PATH; skips without the CLI so CI stays green.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { BASE_URL, buildDriver, quitDriver } from '../helpers/driver.js';
import { saveScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const DIR = '/tmp/foxschema-e2e-copy-export';
const DB = join(DIR, 'copy.db');
const RUN = Date.now().toString(36);
const NAME = `E2E Copy ${RUN}`;

/**
 * The row deliberately holds the values that break a naive serialiser: a SQL
 * NULL, an embedded tab (would split into an extra column), and a double quote
 * (must be doubled inside the quoted field).
 */
const SELECT_SQL =
  "SELECT id, name, city, note FROM grid_rows ORDER BY id;";

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
DROP TABLE IF EXISTS grid_rows;
CREATE TABLE grid_rows (id INTEGER PRIMARY KEY, name TEXT, city TEXT, note TEXT);
INSERT INTO grid_rows VALUES (1, 'Alice', NULL, 'has' || char(9) || 'tab');
INSERT INTO grid_rows VALUES (2, 'say "hi"', 'Austin', 'plain');
`,
  });
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · copy and export', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  const readClipboard = () => driver.evaluate(() => navigator.clipboard.readText());

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    seedDb(DB);

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    // Reading the clipboard back is the only way to assert what was copied.
    await driver
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    await sql.addSqliteCredential(NAME, DB);
    await sql.openView();
    await sql.checkConnection(NAME);
    await sql.setSql(SELECT_SQL);
    await sql.run();
    await sql.waitForResults();
    await driver.waitForSelector('[data-testid="sql-grid-copy-btn"]', { timeout: 15_000 });
  }, 180_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('copies values only, tab-separated, from the toolbar button', async () => {
    await driver.click('[data-testid="sql-grid-copy-btn"]');
    const text = await readClipboard();

    // No header line — the first line is the first data row.
    expect(text.startsWith('id\t')).toBe(false);
    const rows = text.split('\r\n');
    expect(rows).toHaveLength(2);
    // NULL city pastes as an empty cell, not the word "NULL".
    expect(rows[0]).toBe('1\tAlice\t\t"has\ttab"');
    expect(rows[1]).toBe('2\t"say ""hi"""\tAustin\tplain');
  });

  it('copies the header row when asked', async () => {
    await driver.click('[data-testid="sql-grid-copy-menu-btn"]');
    await driver.waitForSelector('[data-testid="sql-grid-copy-menu"]');
    // Capture the open menu for the PR / walkthrough.
    await saveScreenshot(driver, 'sql-editor-copy-menu');
    await driver.click('[data-testid="sql-grid-copy-headers"]');
    const text = await readClipboard();

    const rows = text.split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('id\tname\tcity\tnote');
    expect(rows[1]).toBe('1\tAlice\t\t"has\ttab"');
  });

  it('offers copy from the right-click menu on a data cell', async () => {
    // Clear the clipboard so a stale value cannot pass this test.
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.click('[data-testid="sql-data-grid"] tbody tr td:nth-child(2)', {
      button: 'right',
    });
    await driver.waitForSelector('[data-testid="sql-grid-context-menu"]');
    await driver.click('[data-testid="sql-grid-ctx-copy-headers"]');

    const text = await readClipboard();
    expect(text.split('\r\n')[0]).toBe('id\tname\tcity\tnote');
  });

  it('offers copy from the right-click menu on the row-number column', async () => {
    // That column is not a data cell, and the grid's own handler ignores any
    // click inside a td — it used to be a dead zone with no menu at all.
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.click('[data-testid="sql-row-num"]', { button: 'right' });
    await driver.waitForSelector('[data-testid="sql-grid-context-menu"]');
    await driver.click('[data-testid="sql-grid-ctx-copy-values"]');

    const text = await readClipboard();
    expect(text.split('\r\n')).toHaveLength(2);
    expect(text.startsWith('1\tAlice')).toBe(true);
  });

  it('copies with Cmd/Ctrl-C when the grid has focus', async () => {
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.click('[data-testid="sql-data-grid"]');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.keyboard.press(`${mod}+KeyC`);

    const text = await readClipboard();
    expect(text.split('\r\n')).toHaveLength(2);
    expect(text.startsWith('1\tAlice')).toBe(true);
  });

  it('adds headers with Cmd/Ctrl-Shift-C', async () => {
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.click('[data-testid="sql-data-grid"]');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.keyboard.press(`${mod}+Shift+KeyC`);

    const text = await readClipboard();
    expect(text.split('\r\n')[0]).toBe('id\tname\tcity\tnote');
  });

  it('leaves a real text selection to the browser', async () => {
    // Selecting text inside a cell and pressing Cmd-C must copy that text, not
    // hijack the whole grid — otherwise the grid becomes unusable for a quick
    // single-value copy.
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.evaluate(() => {
      const cell = document.querySelector('[data-testid="sql-data-grid"] td');
      const range = document.createRange();
      range.selectNodeContents(cell as Node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.keyboard.press(`${mod}+KeyC`);

    const text = await readClipboard();
    // Whatever landed, it is not the full two-row grid dump.
    expect(text.split('\r\n').length).toBeLessThan(2);
  });

  it('copies only the chosen columns, in the order they were chosen', async () => {
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.click('[data-testid="sql-grid-copy-menu-btn"]');
    await driver.click('[data-testid="sql-grid-copy-choose-cols"]');
    await driver.waitForSelector('[data-testid="sql-grid-copy-columns"]');

    // Start from nothing, then tick name before id — copy order follows the
    // ticking, not the grid's left-to-right order.
    await driver.click('[data-testid="sql-grid-copy-columns-none"]');
    await driver.click('[data-testid="sql-grid-copy-col-name"]');
    await driver.click('[data-testid="sql-grid-copy-col-id"]');
    // Capture the picker showing the 1/2 order badges for the walkthrough.
    await saveScreenshot(driver, 'sql-editor-copy-columns');
    await driver.click('[data-testid="sql-grid-copy-columns-headers"]');

    const text = await readClipboard();
    expect(text.split('\r\n')[0]).toBe('name\tid');
    expect(text.split('\r\n')[1]).toBe('Alice\t1');
  });

  it('shows the active column scope on the toolbar', async () => {
    // The subset must not be a hidden mode — a later Cmd-C copies 2 of 4.
    const scope = await driver.textContent('[data-testid="sql-grid-copy-scope"]');
    expect(scope).toBe('2/4');
  });

  it('keeps the chosen columns for a later keyboard copy', async () => {
    await driver.evaluate(() => navigator.clipboard.writeText('stale'));
    await driver.click('[data-testid="sql-data-grid"]');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.keyboard.press(`${mod}+KeyC`);

    const text = await readClipboard();
    expect(text.split('\r\n')[0]).toBe('Alice\t1');
  });

  it('restores the full grid via All', async () => {
    await driver.click('[data-testid="sql-grid-copy-menu-btn"]');
    await driver.click('[data-testid="sql-grid-copy-choose-cols"]');
    await driver.waitForSelector('[data-testid="sql-grid-copy-columns"]');
    await driver.click('[data-testid="sql-grid-copy-columns-all"]');
    await driver.click('[data-testid="sql-grid-copy-columns-headers"]');

    const text = await readClipboard();
    expect(text.split('\r\n')[0]).toBe('id\tname\tcity\tnote');
    // The scope badge disappears once the whole grid is back in play.
    expect(await driver.locator('[data-testid="sql-grid-copy-scope"]').count()).toBe(0);
  });

  it('downloads the grid as JSON row objects', async () => {
    await driver.click('[data-testid="sql-grid-export-menu-btn"]');
    await driver.waitForSelector('[data-testid="sql-grid-export-menu"]');

    const [download] = await Promise.all([
      driver.waitForEvent('download', { timeout: 15_000 }),
      driver.click('[data-testid="sql-grid-export-json"]'),
    ]);
    expect(download.suggestedFilename().endsWith('.json')).toBe(true);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(parsed).toHaveLength(2);
    // Keyed by column name, NULL preserved as null (not dropped, not "NULL").
    expect(parsed[0]).toMatchObject({ id: 1, name: 'Alice', city: null });
    expect(parsed[0].note).toBe('has\ttab');
    expect(parsed[1]).toMatchObject({ name: 'say "hi"', city: 'Austin' });
  });
});
