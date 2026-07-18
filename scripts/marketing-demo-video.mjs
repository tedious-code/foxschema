#!/usr/bin/env node
/**
 * Record a Fox Schema marketing demo (WebM → convert to MP4 with ffmpeg).
 *
 * Requires: app on :3001 (Docker), seeded Postgres demo_a / demo_b.
 *
 *   node scripts/marketing-demo-video.mjs
 *   ffmpeg -y -i docs/demo/foxschema-demo.webm -c:v libx264 -pix_fmt yuv420p -an docs/demo/foxschema-demo.mp4
 *   ffmpeg -y -i docs/demo/foxschema-demo.mp4 -vf "fps=8,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse" -loop 0 docs/demo/foxschema-demo.gif
 */
import { chromium } from 'playwright';
import { mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'demo');
const OUT_FILE = join(OUT_DIR, 'foxschema-demo.webm');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const DB_HOST = process.env.DEMO_DB_HOST ?? 'host.docker.internal';

const source = {
  dialect: 'postgres',
  host: DB_HOST,
  port: 5432,
  database: 'foxdb',
  username: 'foxuser',
  password: 'foxpass',
  schema: 'demo_a',
};
const target = { ...source, schema: 'demo_b' };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function slowType(page, selector, value) {
  await page.click(selector);
  await pause(350);
  await page.fill(selector, value);
  await pause(500);
}

async function connect(page, side, fields) {
  const openBtn =
    side === 'source'
      ? '[data-testid="source-config-btn"], [data-testid="source-connected-btn"]'
      : '[data-testid="target-config-btn"], [data-testid="target-connected-btn"]';
  await page.click(openBtn);
  await page.waitForSelector('[data-testid="conn-modal"]');
  await pause(1800); // hold on credential form

  await page.selectOption('[data-testid="conn-dialect-select"]', fields.dialect);
  await pause(600);
  await slowType(page, '[data-testid="conn-host-input"]', fields.host);
  await slowType(page, '[data-testid="conn-port-input"]', String(fields.port));
  await slowType(page, '[data-testid="conn-database-input"]', fields.database);
  await slowType(page, '[data-testid="conn-username-input"]', fields.username);
  await slowType(page, '[data-testid="conn-password-input"]', fields.password);
  await pause(800);

  await page.click('[data-testid="conn-load-schema-btn"]');
  await page.waitForSelector('[data-testid="conn-test-testing"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector(
    '[data-testid="conn-test-success"], [data-testid="conn-test-failed"]',
    { timeout: 45_000 },
  );
  if (await page.locator('[data-testid="conn-test-failed"]').count()) {
    throw new Error(`${side} connection failed`);
  }
  await pause(1500); // show successful test banner

  await page.selectOption('[data-testid="conn-schema-select"]', fields.schema);
  await pause(1000);
  await page.click('[data-testid="conn-save-btn"]');
  await page.waitForSelector('[data-testid="conn-modal"]', { state: 'detached', timeout: 15_000 });
  await pause(900);
}

async function clickDiffItem(page, name) {
  const item = page.locator('[data-testid="diff-item"]').filter({ hasText: name }).first();
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  await item.click();
  await pause(1200);
}

async function clickTab(page, label) {
  const tab = page.getByRole('button', { name: label, exact: true });
  await tab.click();
  await pause(2200);
}

async function showObjectMigrationSql(page, objectName) {
  await clickDiffItem(page, objectName);
  await clickTab(page, 'Schema Blueprint');
  await pause(1400);
  await clickTab(page, 'Migration SQL');
}

async function prepareDeploy(page) {
  const nonDest = page.locator('[data-testid="non-destructive-checkbox"]');
  if (await nonDest.count()) {
    if (!(await nonDest.isChecked())) await nonDest.click();
    await pause(800);
  }
  const deployAll = page.locator('[data-testid="schema-tree"] input[type="checkbox"]').first();
  if (await deployAll.count()) {
    if (!(await deployAll.isChecked())) await deployAll.click();
    await pause(1000);
  }
  for (const testId of ['ack-destructive-drops', 'ack-mysql-binlog-risk', 'ack-narrowing-types']) {
    const cb = page.locator(`[data-testid="${testId}"]`);
    if ((await cb.count()) && !(await cb.isChecked())) {
      await cb.click();
      await pause(500);
    }
  }
}

async function executeMigration(page) {
  await clickTab(page, 'Migration SQL');
  await pause(1200);
  const execute = page.locator('[data-testid="execute-btn"]');
  await execute.waitFor({ state: 'visible', timeout: 10_000 });
  if (await execute.isDisabled()) {
    throw new Error('Execute button disabled — check deploy selection / acknowledgments');
  }
  await execute.click();
  await pause(800);
  const confirm = page.locator('[data-testid="deploy-confirm-btn"]');
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
  await page.waitForSelector('[data-testid="migration-progress-panel"]', { timeout: 20_000 });
  await pause(1500);
  await page.waitForSelector(
    '[data-testid="migration-complete"], [data-testid="migration-failed"]',
    { timeout: 120_000 },
  );
  if (await page.locator('[data-testid="migration-failed"]').count()) {
    throw new Error('Migration failed');
  }
  await pause(2500);
}

async function showHistory(page) {
  await page.click('[data-testid="history-btn"]');
  await page.waitForSelector('[data-testid="history-dialog"]', { timeout: 10_000 });
  await pause(2000);
  const firstRun = page.locator('[data-testid="history-run-item"]').first();
  if (await firstRun.count()) {
    await firstRun.click();
    await pause(3500);
  } else {
    await pause(2500);
  }
  await page.click('[data-testid="history-dialog-close-btn"]');
  await page.waitForSelector('[data-testid="history-dialog"]', { state: 'detached', timeout: 10_000 });
  await pause(800);
}

async function showUnchangedOnMain(page) {
  await page.getByRole('button', { name: 'Clear Comparison' }).click();
  await pause(1500);
  const browse = page.getByRole('button', { name: 'Browse' }).first();
  await browse.click();
  await page.waitForSelector('[data-testid="schema-tree"]', { timeout: 45_000 });
  await pause(1200);
  const unchangedCard = page.getByRole('button', { name: /Unchanged/i }).first();
  if (await unchangedCard.isVisible().catch(() => false)) {
    await unchangedCard.click();
    await pause(1000);
  }
  const unchangedItem = page
    .locator('[data-testid="diff-item"]')
    .filter({ hasText: /UNCHANGED|Products|CUSTOMERS/i })
    .first();
  if (await unchangedItem.count()) {
    await unchangedItem.click();
    await pause(2000);
  }
  const showUnchanged = page.getByRole('checkbox', { name: /Show unchanged/i });
  if (await showUnchanged.count()) {
    if (!(await showUnchanged.isChecked())) await showUnchanged.check();
    await pause(2500);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });
  await pause(1500);

  const skip = page.getByRole('button', { name: /skip|not now|later/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await pause(1000);
  }

  await connect(page, 'source', source);
  await connect(page, 'target', target);

  await page.click('[data-testid="compare-btn"]');
  await page.waitForSelector('[data-testid="schema-tree"]', { timeout: 60_000 });
  await pause(2000);

  await showObjectMigrationSql(page, 'CATEGORIES');
  await showObjectMigrationSql(page, 'V_ACTIVE_PRODUCTS');

  await prepareDeploy(page);
  await executeMigration(page);
  await showHistory(page);
  await showUnchangedOnMain(page);

  await pause(1500);

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) throw new Error('No video recorded');
  renameSync(await video.path(), OUT_FILE);
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
