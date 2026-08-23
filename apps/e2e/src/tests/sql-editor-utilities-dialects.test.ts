/**
 * SQL Editor · Utilities across every dialect with E2E_* SOURCE env vars.
 *
 * Covers (non-destructive — no Clone Apply on shared demo seeds):
 *   - Utilities sidebar entries
 *   - Index Management load
 *   - Clone Table load + SQL preview
 *   - Server Insights (system / sizes / pool / sessions)
 *   - Query files modal open
 */
import { describe, it, beforeAll, beforeEach, afterAll, afterEach, expect } from 'vitest';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { getSourceConfig, hasConfig } from '../helpers/db-config.js';
import { saveScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const ALL_DIALECTS = [
  'postgres',
  'mysql',
  'mariadb',
  'sqlserver',
  'oracle',
  'db2',
  'sqlite',
  'cockroachdb',
  'yugabytedb',
  'azuresql',
  'clickhouse',
  'redshift',
  'tidb',
  'duckdb',
] as const;

const UTILITY_BUTTONS = [
  'utilities-index-management',
  'utilities-clone-table',
  'utilities-query-files',
  'utilities-connection-pool',
  'utilities-user-connections',
  'utilities-system-info',
  'utilities-object-sizes',
] as const;

const configured = ALL_DIALECTS.filter((d) => hasConfig(d));

describe.skipIf(configured.length === 0)('SQL Editor · Utilities (all configured dialects)', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;
  const credNameByDialect = new Map<string, string>();
  /** Dialects whose credential would not connect, with why. */
  const unreachable = new Map<string, string>();
  const runId = Date.now().toString(36);

  beforeAll(async () => {
    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    // One unreachable engine used to abort beforeAll and take all 41 tests with
    // it — a stopped container cost the whole suite rather than its own three
    // cases. Record what actually connected and skip the rest.
    for (const dialect of configured) {
      const cfg = getSourceConfig(dialect)!;
      const name = `E2E Util ${dialect} ${runId}`;
      try {
        await sql.addCredential(name, cfg);
        credNameByDialect.set(dialect, name);
      } catch (err) {
        unreachable.set(dialect, err instanceof Error ? err.message : String(err));
        // A failed credential leaves the connection modal stacked over the
        // credentials list, and that overlay intercepts every later click —
        // which is how one unreachable engine used to fail all the reachable
        // ones queued behind it. Closing the modals individually proved
        // fragile; a reload is the one reset that always lands.
        await driver.reload();
        await driver.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });
      }
    }
    if (credNameByDialect.size === 0) {
      throw new Error(
        `No configured dialect was reachable:\n${[...unreachable]
          .map(([d, e]) => `  ${d}: ${e}`)
          .join('\n')}`
      );
    }
    for (const [d, e] of unreachable) {
      console.warn(`[utilities] skipping ${d} — ${e.split('\n')[0]}`);
    }

    await sql.openView();
  }, 300_000);

  afterEach(async () => {
    await sql.closeCloneTable().catch(() => undefined);
    await sql.closeIndexManagement().catch(() => undefined);
    await sql.closeServerInsights().catch(() => undefined);
    const fq = driver.locator('[data-testid="file-query-modal"]');
    if (await fq.isVisible().catch(() => false)) {
      await fq.locator('button[aria-label="Close"]').click().catch(async () => {
        await driver.keyboard.press('Escape');
      });
      await fq.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    }
    await sql.dismissOverlays().catch(() => undefined);
  });

  afterAll(async () => {
    if (driver) await quitDriver(driver);
  });

  it('Utilities sidebar lists every utility entry', async () => {
    await sql.ensureSidebarSectionOpen('utilities');
    const section = driver.locator('[data-testid="sql-sidebar-utilities"]');
    for (const id of UTILITY_BUTTONS) {
      expect(await section.locator(`[data-testid="${id}"]`).isVisible(), id).toBe(true);
    }
  });

  for (const dialect of configured) {
    describe(dialect, () => {
      const cred = () => credNameByDialect.get(dialect)!;
      // Reachability is only known after beforeAll, so gate at run time.
      // Vitest passes a context; `this.skip()` is Mocha's shape and silently
      // did nothing here, turning "engine is down" into a failing test.
      beforeEach((ctx) => {
        if (!credNameByDialect.has(dialect)) ctx.skip();
      });

      it('Index Management loads indexes', async () => {
        await sql.openIndexManagement();
        await sql.selectUtilityConnection(cred(), 'index-mgmt-connection');
        await driver.locator('[data-testid="index-mgmt-load"]').click();
        await driver.waitForFunction(
          () => {
            const status = document.querySelector('[data-testid="index-mgmt-status"]');
            const groups = document.querySelector('[data-testid="index-mgmt-groups"]');
            const err = document.querySelector('[data-testid="index-management-modal"]')?.textContent ?? '';
            const t = `${status?.textContent ?? ''}\n${groups?.textContent ?? ''}\n${err}`;
            return (
              /index/i.test(t) ||
              /customer|order|product|coupon/i.test(t) ||
              /no index|0 index|empty/i.test(t) ||
              /error|failed|denied/i.test(t)
            );
          },
          { timeout: 60_000 }
        );
        const body = await driver.locator('[data-testid="index-management-modal"]').innerText();
        // Soft-fail only on hard auth/connect errors; empty indexes can be valid.
        expect(body.toLowerCase()).not.toMatch(/credential not found|password required/);
        await saveScreenshot(driver, `utilities-index-${dialect}`);
        await sql.closeIndexManagement();
      });

      it('Clone Table loads a customers table and shows SQL preview', async () => {
        await sql.openCloneTable();
        await sql.selectUtilityConnection(cred(), 'clone-table-connection');
        await driver.locator('[data-testid="clone-table-load"]').click();
        await driver.waitForFunction(
          () => {
            const status = document.querySelector('[data-testid="clone-status"]')?.textContent ?? '';
            const err = document.querySelector('[data-testid="clone-error"]')?.textContent ?? '';
            const sel = document.querySelector(
              '[data-testid="clone-table-name"]'
            ) as HTMLSelectElement | null;
            const opts = sel ? [...sel.options].map((o) => o.value).filter(Boolean) : [];
            return err.length > 0 || /loaded/i.test(status) || opts.length > 0;
          },
          { timeout: 60_000 }
        );
        const err =
          (await driver.locator('[data-testid="clone-error"]').textContent().catch(() => '')) ?? '';
        expect(err.trim(), `clone load error (${dialect}): ${err}`).toBe('');

        const tableValue = await driver.evaluate(() => {
          const sel = document.querySelector(
            '[data-testid="clone-table-name"]'
          ) as HTMLSelectElement | null;
          if (!sel) return '';
          const hit = [...sel.options].find((o) => /customers/i.test(o.value || o.textContent || ''));
          return hit?.value ?? '';
        });
        expect(tableValue, `no customers table for ${dialect}`).not.toBe('');
        await driver.locator('[data-testid="clone-table-name"]').selectOption(tableValue);

        await driver.waitForSelector('[data-testid="clone-sql-preview"]', { timeout: 15_000 });
        const preview = (
          await driver.locator('[data-testid="clone-sql-preview"]').innerText()
        ).toLowerCase();
        expect(preview).toMatch(/rename|alter table|create\s+table/);
        await saveScreenshot(driver, `utilities-clone-${dialect}`);
        await sql.closeCloneTable();
      });

      it('Server Insights opens system, sizes, pool, and sessions', async () => {
        await sql.openServerInsights('system');
        await sql.selectUtilityConnection(cred(), 'server-insights-connection');
        // Refresh is deliberately disabled where the engine has no probe for
        // the tab — DuckDB is embedded, so it has no pool/sessions/system DMVs
        // at all. The modal is expected to say so instead, which is what the
        // assertion below checks; the loop already tolerated this and the first
        // click did not.
        await driver
          .locator('[data-testid="server-insights-refresh"]')
          .click({ timeout: 5_000 })
          .catch(() => undefined);
        await driver.waitForTimeout(1200);
        const modal = driver.locator('[data-testid="server-insights-modal"]');
        expect(await modal.isVisible()).toBe(true);
        // Either it produced something, or it explained why it cannot.
        expect((await modal.innerText()).length).toBeGreaterThan(20);

        for (const tab of ['sizes', 'pool', 'sessions'] as const) {
          await driver.locator(`[data-testid="server-insights-tab-${tab}"]`).click();
          await driver.locator('[data-testid="server-insights-refresh"]').click().catch(() => undefined);
          await driver.waitForTimeout(900);
          const text = (await modal.innerText()).toLowerCase();
          // Any of: real data, empty state, or explicit unsupported — all OK as long as modal stays up.
          expect(text.length).toBeGreaterThan(20);
        }
        await saveScreenshot(driver, `utilities-insights-${dialect}`);
        await sql.closeServerInsights();
      });
    });
  }

  it('Query files utility opens the import modal', async () => {
    await sql.ensureSidebarSectionOpen('utilities');
    await driver.locator('[data-testid="utilities-query-files"]').click();
    await driver.waitForSelector('[data-testid="file-query-modal"]', { timeout: 10_000 });
    expect(await driver.locator('[data-testid="file-query-format"]').isVisible()).toBe(true);
    await saveScreenshot(driver, 'utilities-query-files');
    await driver.locator('[data-testid="file-query-modal"] button[aria-label="Close"]').click();
    await driver
      .locator('[data-testid="file-query-modal"]')
      .waitFor({ state: 'detached', timeout: 8_000 });
  });
});
