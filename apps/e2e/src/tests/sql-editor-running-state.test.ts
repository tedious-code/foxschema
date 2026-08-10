/**
 * While a query is in flight the results area must show progress, in either
 * layout. Side-by-side used to render an empty container until the first rows
 * arrived: `stmtCount` is derived from the statements that have already run
 * and from per-run results, and a dispatch resets both — so the loop that
 * draws the "running" placeholders had nothing to iterate over.
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

const DIR = '/tmp/foxschema-e2e-running-state';
const DB = join(DIR, 'slow.db');
const RUN = Date.now().toString(36);
const NAME = `E2E Slow ${RUN}`;

/** Roughly a second of work — long enough to observe the in-flight state. */
const SLOW_SQL =
  'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000000) ' +
  'SELECT count(*) AS n FROM c;';

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · in-flight results state', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    execFileSync('sqlite3', [DB], { input: 'CREATE TABLE t (id INTEGER);\n' });

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

  it('shows progress while running in by-credential layout', async () => {
    await sql.setLayoutByCredential();
    await sql.setSql(SLOW_SQL);
    await sql.run();

    // Do not wait for results — assert on the in-flight frame.
    await driver.waitForSelector('[data-testid="sql-results-running"]', { timeout: 10_000 });
    await sql.waitForResults();
  });

  it('keeps side-by-side populated for the whole run, in-flight included', async () => {
    await sql.setLayoutSideBySide();
    await sql.setSql(SLOW_SQL);

    // Sample inside the page, driven by DOM mutations. The blank window is the
    // gap between dispatching the run and the first statement being reported —
    // tens of milliseconds. A Playwright round-trip per sample steps straight
    // over it, and requestAnimationFrame is throttled in headless Chromium
    // (~6 frames a second here). A MutationObserver fires on the very render
    // that empties the panel, so the window cannot be missed.
    await driver.evaluate(() => {
      const w = window as unknown as { __foxSamples?: unknown[]; __foxStop?: () => void };
      w.__foxSamples = [];
      const started = performance.now();
      const record = (): void => {
        const el = document.querySelector(
          '[data-testid="sql-results-side-by-side"]'
        ) as HTMLElement | null;
        (w.__foxSamples as unknown[]).push({
          t: Math.round(performance.now() - started),
          present: !!el,
          len: el ? (el.innerText ?? '').trim().length : 0,
          running: !!document.querySelector('[data-testid="sql-results-running"]'),
        });
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      const timer = window.setInterval(record, 10);
      w.__foxStop = () => {
        observer.disconnect();
        window.clearInterval(timer);
      };
      record();
    });

    await sql.run();
    // Bracket the whole run explicitly. `waitForResults` only waits for the
    // container, which the previous test already left mounted, so it would
    // return at once and stop sampling after ~80ms.
    await driver.waitForSelector('[data-testid="sql-results-running"]', { timeout: 10_000 });
    await driver.waitForSelector('[data-testid="sql-results-running"]', {
      state: 'detached',
      timeout: 20_000,
    });

    const samples = (await driver.evaluate(() => {
      const w = window as unknown as { __foxSamples: unknown[]; __foxStop?: () => void };
      w.__foxStop?.();
      return w.__foxSamples;
    })) as { t: number; present: boolean; len: number; running: boolean }[];

    // An absent container is the same defect as an empty one — the user has
    // nothing to read either way.
    const blank = samples.filter((s) => !s.present || s.len === 0);
    expect(
      blank.slice(0, 5),
      `results area was blank for ${blank.length} of ${samples.length} frames`
    ).toEqual([]);
    // Guard against the sampler having missed the run entirely.
    expect(samples.some((s) => s.running), 'never observed the in-flight state').toBe(true);
    // Sanity that the sampler actually ran; samples are event-driven, so the
    // count tracks DOM activity rather than elapsed time.
    expect(samples.length).toBeGreaterThan(3);
  });
});
