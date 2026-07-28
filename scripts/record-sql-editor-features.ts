/**
 * Recorded Playwright demo of 0.1.100 SQL Editor features:
 * - Node sql`` bridge samples (parameterized read, injection-safe, bulk load)
 * - Data peek (Ctrl-click) + FK drill-down
 *
 * Output: /opt/cursor/artifacts/recordings/sql-editor-new-features.webm
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SQL_EDITOR_SAMPLE_BOOKMARKS } from '../apps/web/src/frontend/lib/sqlEditorSamples.ts';

const BASE = process.env.FOX_BASE_URL ?? 'http://127.0.0.1:5173';
const ARTIFACT_DIR = '/opt/cursor/artifacts/recordings';
const SHOT_DIR = '/opt/cursor/artifacts/screenshots';
const DB_DIR = '/tmp/foxschema-sqlite';
const DB = path.join(DB_DIR, `peek-demo-${Date.now()}.db`);
const CRED = `PeekDemo ${Date.now()}`;
const VIDEO_TMP = '/tmp/cursor/pw-record';

function seedDb(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id)
    );
    INSERT INTO customers (id, name) VALUES
      (1, 'Ada'),
      (2, 'Grace'),
      (3, 'O''Brien');
    INSERT INTO accounts (id, email, customer_id) VALUES
      (10, 'ada@example.com', 1),
      (20, 'grace@example.com', 2),
      (30, 'o''brien@example.com', 3);
  `);
  db.close();
}

async function dismissOverlays(page: Page) {
  const skip = page.getByRole('button', { name: /skip for now/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();

  const pwdCancel = page.locator('[data-testid="sql-session-password-cancel"]');
  if (await pwdCancel.isVisible().catch(() => false)) await pwdCancel.click();

  const write = page.locator('[data-testid="sql-write-confirm"]');
  if (await write.isVisible().catch(() => false)) {
    const ok = page.locator('[data-testid="sql-write-confirm-btn"]');
    if (await ok.isVisible().catch(() => false)) await ok.click();
  }
}

async function pause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

async function pasteSql(page: Page, sql: string) {
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.insertText(sql);
  await pause(page, 600);
}

async function setSafeMode(page: Page, on: boolean) {
  const box = page.locator('[data-testid="sql-safe-mode"]');
  await box.waitFor({ state: 'visible' });
  const checked = await box.isChecked();
  if (checked !== on) await box.click({ force: true });
  await pause(page, 300);
}

async function runSql(page: Page) {
  await page.locator('[data-testid="sql-run-btn"]').click();
  await pause(page, 400);
  const confirm = page.locator('[data-testid="sql-write-confirm-btn"]');
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
  await page.waitForSelector(
    '[data-testid="sql-results-by-credential"], [data-testid="sql-results-side-by-side"]',
    { timeout: 45_000 }
  );
  await pause(page, 1200);
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.mkdirSync(VIDEO_TMP, { recursive: true });
  seedDb(DB);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_TMP, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const log: Array<Record<string, unknown>> = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    try {
      await fn();
      log.push({ step: name, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      log.push({ step: name, ok: false, ms: Date.now() - t0, error: String(e) });
      await page.screenshot({ path: path.join(SHOT_DIR, `record-fail-${name}.png`), fullPage: true });
      throw e;
    }
  };

  await step('boot', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await pause(page, 1200);
    await dismissOverlays(page);
    await page.locator('[data-testid="toolbar"]').waitFor({ state: 'visible' });
  });

  await step('open-sql-editor', async () => {
    await page.locator('[data-testid="view-sql-editor-btn"]').click();
    await page.locator('[data-testid="sql-editor-view"]').waitFor({ state: 'visible' });
    await pause(page, 800);
    await dismissOverlays(page);
  });

  await step('add-sqlite-credential', async () => {
    await page.locator('[data-testid="credentials-btn"]').click();
    await page.locator('[data-testid="cred-manager"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="cred-add-btn"]').click();
    await page.locator('[data-testid="conn-modal"]').waitFor({ state: 'visible' });
    await page.fill('[data-testid="conn-name-input"]', CRED);
    await page.selectOption('[data-testid="conn-dialect-select"]', 'sqlite');
    await page.fill('[data-testid="conn-database-input"]', DB);
    await page.fill('[data-testid="conn-password-input"]', 'unused');
    await page.locator('[data-testid="conn-save-password"]').check();
    await page.click('[data-testid="conn-load-schema-btn"]');
    await page.waitForSelector('[data-testid="conn-test-success"]', { timeout: 25_000 });
    await pause(page, 600);
    await page.click('[data-testid="conn-save-btn"]');
    await page.waitForSelector('[data-testid="conn-modal"]', { state: 'detached' });
    await page.locator('[data-testid="cred-close-btn"]').click();
    await page.waitForSelector('[data-testid="cred-manager"]', { state: 'detached' });
    await pause(page, 500);
  });

  await step('check-destination', async () => {
    const sel = `[data-testid="sql-conn-check-${CRED}"]`;
    await page.waitForSelector(sel);
    const box = page.locator(sel);
    if (!(await box.isChecked())) await box.check();
    await pause(page, 800);
  });

  await step('install-samples', async () => {
    const install = page.locator('[data-testid="sql-bookmark-install-samples"]');
    await install.waitFor({ state: 'visible' });
    await install.click();
    await pause(page, 1000);
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-01-samples.png') });
  });

  await step('sample-sql-basics', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-node-sql-basics')!;
    await setSafeMode(page, true);
    await pasteSql(page, sample.sql);
    await pause(page, 800);
    await runSql(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-02-sql-basics.png') });
  });

  await step('sample-injection-safe', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-node-sql-injection-safe')!;
    await pasteSql(page, sample.sql);
    await pause(page, 600);
    await runSql(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-03-injection-safe.png') });
  });

  await step('sample-bulk-load', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-node-sql-bulk-load')!;
    await setSafeMode(page, false);
    await pasteSql(page, sample.sql);
    await pause(page, 600);
    await runSql(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-04-bulk-load.png') });
  });

  await step('sample-migrate', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-node-sql-migrate')!;
    await pasteSql(page, sample.sql);
    await pause(page, 600);
    await runSql(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-05-migrate.png') });
  });

  await step('data-peek-and-fk-drill', async () => {
    // Ensure schema explorer shows tables for this connection
    const explorer = page.locator('[data-testid="sql-schema-explorer"]');
    await explorer.waitFor({ state: 'visible', timeout: 20_000 });

    // Pick accounts in schema explorer (may need to expand TABLES)
    const accounts = explorer.getByText('accounts', { exact: true }).first();
    if ((await accounts.count()) === 0) {
      const group = explorer.locator('[data-testid="sql-schema-group-TABLE"]');
      if (await group.count()) {
        await group.locator('button').first().click().catch(() => undefined);
        await pause(page, 400);
      }
    }
    await accounts.waitFor({ state: 'visible', timeout: 30_000 });

    // Ctrl-click = data peek
    await accounts.click({ modifiers: ['Control'] });
    await page.locator('[data-testid="data-peek"]').waitFor({ state: 'visible', timeout: 20_000 });
    await pause(page, 1500);
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-06-peek-accounts.png') });

    // FK cells are cyan dotted-underline buttons in DataGrid.
    const fkLinks = page.locator('[data-testid="data-peek"] button.underline.text-cyan-300');
    await fkLinks.first().waitFor({ state: 'visible', timeout: 10_000 });
    log.push({ fkLinkCount: await fkLinks.count() });
    // Click the first customer_id link (value "1" / "2" / "3").
    await fkLinks.first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="data-peek-grid-"]').length >= 2,
      { timeout: 15_000 }
    );
    await pause(page, 1500);

    const crumb = page.locator('[data-testid^="data-peek-crumb-"]');
    const grids = page.locator('[data-testid^="data-peek-grid-"]');
    log.push({
      peekCrumbs: await crumb.count(),
      peekGrids: await grids.count(),
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'record-07-peek-fk-drill.png') });
    await pause(page, 1500);

    // Walk breadcrumb back to the first hop, then close.
    if ((await crumb.count()) > 1) {
      await crumb.first().click();
      await pause(page, 900);
    }

    // Close peek
    const close = page.locator('[data-testid="data-peek-close"]');
    if (await close.isVisible().catch(() => false)) await close.click();
    await pause(page, 800);
  });

  await step('open-bookmark-sample', async () => {
    const open = page.locator('[data-testid="sql-bookmark-open-sample-node-sql-chunked"]');
    if (await open.count()) {
      await open.click();
      await pause(page, 1200);
      await page.screenshot({ path: path.join(SHOT_DIR, 'record-08-chunked-bookmark.png') });
    }
  });

  await pause(page, 1000);

  // Finalize video: must close context before reading video path
  const video = page.video();
  await context.close();
  await browser.close();

  let videoPath = video ? await video.path() : null;
  const outWebm = path.join(ARTIFACT_DIR, 'sql-editor-new-features.webm');
  const outMp4 = path.join(ARTIFACT_DIR, 'sql-editor-new-features.mp4');

  if (videoPath && fs.existsSync(videoPath)) {
    fs.copyFileSync(videoPath, outWebm);
    // Transcode to mp4 for broader playback in Cursor walkthroughs
    const { spawnSync } = await import('node:child_process');
    const ff = spawnSync(
      'ffmpeg',
      ['-y', '-i', outWebm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outMp4],
      { encoding: 'utf8' }
    );
    log.push({
      videoWebm: outWebm,
      videoMp4: fs.existsSync(outMp4) ? outMp4 : null,
      ffmpegStatus: ff.status,
      ffmpegErr: (ff.stderr || '').slice(-400),
    });
  } else {
    log.push({ videoWebm: null, error: 'no video file produced' });
  }

  const summaryPath = path.join(ARTIFACT_DIR, 'sql-editor-new-features.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ cred: CRED, db: DB, log }, null, 2));
  console.log(JSON.stringify({ cred: CRED, db: DB, log }, null, 2));

  const failed = log.filter((l) => l.ok === false);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
