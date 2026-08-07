/**
 * Compare data with many SQLite targets: Sync scroll + CSV all screenshots.
 * Requires web app + API (`npm run dev`) and sqlite3 on PATH.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { saveScreenshot, saveSeoScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const DIR = '/tmp/foxschema-e2e-compare-multi';
const RUN = Date.now().toString(36);

const TARGETS = [
  { file: 'source.db', name: `E2E Src ${RUN}`, cityPrefix: 'Src' },
  { file: 'target-a.db', name: `E2E TgtA ${RUN}`, cityPrefix: 'A' },
  { file: 'target-b.db', name: `E2E TgtB ${RUN}`, cityPrefix: 'B' },
  { file: 'target-c.db', name: `E2E TgtC ${RUN}`, cityPrefix: 'C' },
] as const;

function hasSqlite3(): boolean {
  try {
    execSync('which sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Seed enough rows to exercise vertical scroll sync across panes. */
function seedDb(path: string, cityPrefix: string): void {
  const inserts: string[] = [];
  for (let i = 1; i <= 40; i++) {
    const city =
      i === 1
        ? `${cityPrefix}-Denver`
        : i === 3 && cityPrefix !== 'Src'
          ? `${cityPrefix}-Only`
          : i % 7 === 0
            ? `${cityPrefix}-X${i}`
            : `Shared-${i}`;
    const name =
      i === 2 && cityPrefix !== 'Src'
        ? `${cityPrefix}-Renamed`
        : `Row-${i}`;
    // Target C skips id=5 (source-only → Add); Target B adds extra via city-only row already.
    if (cityPrefix === 'C' && i === 5) continue;
    inserts.push(
      `INSERT INTO customers (id, name, city) VALUES (${i}, '${name}', '${city}');`
    );
  }
  execFileSync('sqlite3', [path], {
    input: `
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT
);
${inserts.join('\n')}
`,
  });
}

const ready = hasSqlite3();

describe.skipIf(!ready)('SQL Editor · Compare multi-target Sync scroll + CSV all', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    for (const t of TARGETS) {
      const path = join(DIR, t.file);
      seedDb(path, t.cityPrefix);
      expect(existsSync(path)).toBe(true);
    }

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    for (const t of TARGETS) {
      await sql.addSqliteCredential(t.name, join(DIR, t.file));
    }
  }, 180_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('compares Source + three Targets with Sync scroll and CSV all', async () => {
    await sql.openView();
    for (const t of TARGETS) {
      await sql.checkConnection(t.name);
    }
    await sql.setSql('SELECT id, name, city FROM customers ORDER BY id;');
    await sql.run();
    await sql.waitForResults();
    await sql.setLayoutSideBySide();

    await driver.waitForSelector('[data-testid="sql-result-compare-toggle-0"]', {
      timeout: 15_000,
    });
    await sql.compareToggle(0).click();
    expect(await sql.compareToggle(0).isChecked()).toBe(true);

    // Pin Source as baseline so Target A/B/C labels match the seeded roles.
    const pickOptionValue = async (selectTestId: string, nameSubstr: string) => {
      const value = await driver.evaluate(
        ({ testId, name }) => {
          const sel = document.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement | null;
          if (!sel) return null;
          for (const opt of [...sel.options]) {
            if (opt.textContent?.includes(name)) return opt.value;
          }
          return null;
        },
        { testId: selectTestId, name: nameSubstr }
      );
      expect(value).toBeTruthy();
      await driver.locator(`[data-testid="${selectTestId}"]`).selectOption(value!);
    };
    await pickOptionValue('sql-result-compare-baseline-0', TARGETS[0].name);
    await sql.compareDestSelect(0).waitFor({ state: 'visible', timeout: 10_000 });
    await pickOptionValue('sql-result-compare-dest-0', TARGETS[1].name);

    await sql.compareSyncScroll(0).waitFor({ state: 'visible', timeout: 10_000 });
    expect(await sql.compareSyncScroll(0).isChecked()).toBe(true);
    expect(await sql.compareExportCsvAll(0).isVisible()).toBe(true);

    await driver.waitForSelector('[data-testid="sql-result-compare-legend-0"]', {
      timeout: 10_000,
    });

    // Four result panes (Source + three targets).
    const paneCount = await driver
      .locator('[data-testid="sql-result-pane-row"] [data-testid="sql-data-grid"]')
      .count();
    expect(paneCount).toBeGreaterThanOrEqual(4);

    const results = await sql.resultsText();
    expect(results).toMatch(/Source|Target/i);
    expect(results).toMatch(/Sync scroll|CSV all/i);

    await saveScreenshot(driver, 'compare-multi-target-sync-scroll');
    await saveSeoScreenshot(driver, 'compare-multi-target-sync-scroll');

    // Scroll the first grid body — with Sync scroll on, peers should move.
    const scrolled = await driver.evaluate(() => {
      const scrollers = [
        ...document.querySelectorAll('[data-testid="sql-result-pane-row"] [data-testid="sql-data-grid"]'),
      ] as HTMLElement[];
      if (scrollers.length < 2) return { ok: false as const, reason: `scrollers=${scrollers.length}` };
      const first = scrollers[0]!;
      first.scrollTop = 280;
      first.dispatchEvent(new Event('scroll'));
      const tops = scrollers.slice(0, 4).map((el) => el.scrollTop);
      return { ok: true as const, tops, count: scrollers.length };
    });

    if (!scrolled.ok) {
      throw new Error(`Expected multiple sql-data-grid scrollers: ${scrolled.reason}`);
    }
    expect(scrolled.count).toBeGreaterThanOrEqual(2);
    const synced = scrolled.tops.filter((t) => t >= 200).length;
    expect(synced).toBeGreaterThanOrEqual(2);

    await saveScreenshot(driver, 'compare-multi-target-scrolled');

    // Toggle Sync scroll off — control remains available.
    await sql.compareSyncScroll(0).click();
    expect(await sql.compareSyncScroll(0).isChecked()).toBe(false);
    await saveScreenshot(driver, 'compare-multi-target-sync-off');
    await sql.compareSyncScroll(0).check();

    // CSV all → one file with Source / Target prefixes.
    const [download] = await Promise.all([
      driver.waitForEvent('download', { timeout: 15_000 }),
      sql.compareExportCsvAll(0).click(),
    ]);
    const suggested = download.suggestedFilename();
    expect(suggested).toMatch(/\.csv$/i);
    const tmp = join(DIR, 'compare-all.csv');
    await download.saveAs(tmp);
    const csv = readFileSync(tmp, 'utf8');
    expect(csv).toMatch(/Source\./);
    expect(csv).toMatch(/Target/);
    expect(csv.split('\n').length).toBeGreaterThan(10);

    await saveScreenshot(driver, 'compare-multi-target-after-csv');

    // Maximize with Sync scroll + CSV all in modal chrome.
    await sql.compareMaximize(0).click();
    await driver.waitForSelector('[data-testid="sql-result-compare-modal-0"]', {
      timeout: 10_000,
    });
    expect(
      await driver.locator('[data-testid="sql-result-compare-sync-scroll-modal-0"]').isVisible()
    ).toBe(true);
    expect(
      await driver.locator('[data-testid="sql-result-compare-export-csv-modal-0"]').isVisible()
    ).toBe(true);
    await saveScreenshot(driver, 'compare-multi-target-maximized');
    await saveSeoScreenshot(driver, 'compare-multi-target-maximized');

    await driver.locator('[data-testid="sql-result-compare-close-0"]').click();
    await driver.waitForSelector('[data-testid="sql-result-compare-modal-0"]', {
      state: 'detached',
      timeout: 10_000,
    });
  });
});
