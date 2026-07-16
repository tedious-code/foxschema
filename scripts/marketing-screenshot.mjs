#!/usr/bin/env node
/**
 * Capture marketing screenshots of a live schema diff.
 * Requires seeded containers + `npm run dev`.
 *
 *   E2E_BASE_URL=http://localhost:5173 node scripts/marketing-screenshot.mjs
 *   E2E_BASE_URL=http://localhost:5173 node scripts/marketing-screenshot.mjs db2
 *   E2E_BASE_URL=http://localhost:5173 node scripts/marketing-screenshot.mjs all
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'marketing');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const PROFILES = {
  postgres: {
    out: 'schema-diff-postgres.png',
    source: {
      dialect: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'foxdb',
      username: 'foxuser',
      password: 'foxpass',
      schema: 'demo_a',
    },
    target: {
      dialect: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'foxdb',
      username: 'foxuser',
      password: 'foxpass',
      schema: 'demo_b',
    },
  },
  db2: {
    out: 'schema-diff-db2.png',
    source: {
      dialect: 'db2',
      host: 'localhost',
      port: 50000,
      database: 'foxdb',
      username: 'db2inst1',
      password: 'foxpass',
      schema: 'DEMO_A',
    },
    target: {
      dialect: 'db2',
      host: 'localhost',
      port: 50000,
      database: 'foxdb',
      username: 'db2inst1',
      password: 'foxpass',
      schema: 'DEMO_B',
    },
  },
};

async function connect(page, side, fields) {
  const openBtn =
    side === 'source'
      ? '[data-testid="source-config-btn"], [data-testid="source-connected-btn"]'
      : '[data-testid="target-config-btn"], [data-testid="target-connected-btn"]';
  await page.click(openBtn);
  await page.waitForSelector('[data-testid="conn-modal"]');
  await page.selectOption('[data-testid="conn-dialect-select"]', fields.dialect);
  await page.fill('[data-testid="conn-host-input"]', fields.host);
  await page.fill('[data-testid="conn-port-input"]', String(fields.port));
  await page.fill('[data-testid="conn-database-input"]', fields.database);
  await page.fill('[data-testid="conn-username-input"]', fields.username);
  await page.fill('[data-testid="conn-password-input"]', fields.password);
  await page.click('[data-testid="conn-load-schema-btn"]');
  await page.waitForSelector(
    '[data-testid="conn-test-success"], [data-testid="conn-test-failed"]',
    { timeout: 45_000 },
  );
  const failed = await page.locator('[data-testid="conn-test-failed"]').count();
  if (failed) {
    const text = await page.locator('[data-testid="conn-modal"]').innerText();
    throw new Error(`${side} connection failed:\n${text}`);
  }
  const selectCount = await page.locator('[data-testid="conn-schema-select"]').count();
  if (selectCount) {
    const options = await page.locator('[data-testid="conn-schema-select"] option').allTextContents();
    const want = fields.schema.toUpperCase();
    const match = options.find((o) => o.trim().toUpperCase() === want) ?? fields.schema;
    await page.selectOption('[data-testid="conn-schema-select"]', { label: match.trim() });
  } else {
    await page.fill('[data-testid="conn-schema-input"]', fields.schema);
  }
  await page.click('[data-testid="conn-save-btn"]');
  await page.waitForSelector('[data-testid="conn-modal"]', { state: 'detached', timeout: 15_000 });
}

async function capture(page, profile) {
  const clear = page.getByRole('button', { name: /clear comparison/i });
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
    await page.waitForTimeout(300);
  }

  await connect(page, 'source', profile.source);
  await connect(page, 'target', profile.target);
  await page.click('[data-testid="compare-btn"]');
  await page.waitForSelector('[data-testid="schema-tree"]', { timeout: 60_000 });
  await page.waitForTimeout(800);

  const firstDiff = page.locator('[data-testid="diff-item"]').first();
  if (await firstDiff.count()) {
    await firstDiff.click();
    await page.waitForTimeout(400);
  }

  const out = join(OUT_DIR, profile.out);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`Wrote ${out}`);
}

async function main() {
  const arg = (process.argv[2] ?? 'postgres').toLowerCase();
  const names = arg === 'all' ? Object.keys(PROFILES) : [arg];
  for (const name of names) {
    if (!PROFILES[name]) {
      throw new Error(`Unknown profile "${name}". Use: postgres | db2 | all`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });

  const skip = page.getByRole('button', { name: /skip|not now|later/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }

  for (const name of names) {
    await capture(page, PROFILES[name]);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
