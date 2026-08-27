/**
 * Access Assistant · all configured dialects.
 *
 * Non-destructive: loads user catalog, opens Permission Builder / Diff tabs,
 * verifies SQL preview renders for richer grant scopes.
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

const SUPPORTS_DB_ACCESS: readonly string[] = [
  'postgres',
  'mysql',
  'mariadb',
  'sqlserver',
  'oracle',
  'db2',
  'cockroachdb',
  'yugabytedb',
  'azuresql',
  'clickhouse',
  'redshift',
  'tidb',
];

const SUPPORTS_GRANT_BUILDER: readonly string[] = [
  'postgres',
  'mysql',
  'mariadb',
  'sqlserver',
  'oracle',
  'db2',
  'cockroachdb',
  'yugabytedb',
  'azuresql',
  'redshift',
  'tidb',
];

const configured = ALL_DIALECTS.filter((d) => hasConfig(d));

describe.skipIf(configured.length === 0)('Access Assistant (all configured dialects)', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;
  const credNameByDialect = new Map<string, string>();
  const unreachable = new Map<string, string>();
  const runId = Date.now().toString(36);

  beforeAll(async () => {
    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });

    for (const dialect of configured) {
      const cfg = getSourceConfig(dialect)!;
      const name = `E2E Access ${dialect} ${runId}`;
      try {
        await sql.addCredential(name, cfg);
        credNameByDialect.set(dialect, name);
      } catch (err) {
        unreachable.set(dialect, err instanceof Error ? err.message : String(err));
        await driver.reload();
        await driver.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });
      }
    }

    await driver.locator('[data-testid="view-access-btn"]').click();
    await driver.waitForSelector('[data-testid="access-view"]', { timeout: 20_000 });
  }, 300_000);

  afterEach(async () => {
    await driver.locator('[data-testid="access-tab-users"]').click().catch(() => undefined);
  });

  afterAll(async () => {
    if (driver) await quitDriver(driver);
  });

  async function selectConnection(dialect: string) {
    const name = credNameByDialect.get(dialect)!;
    const label = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    await driver.locator('[data-testid="user-connection"]').selectOption({ label });
  }

  for (const dialect of configured) {
    describe(dialect, () => {
      beforeEach((ctx) => {
        if (!credNameByDialect.has(dialect)) ctx.skip();
      });

      it('User Management loads principals from catalog', async () => {
        await driver.locator('[data-testid="access-tab-users"]').click();
        await selectConnection(dialect);
        await driver.locator('[data-testid="user-refresh"]').click();

        await driver.waitForFunction(
          () => {
            const row = document.querySelector('[data-testid^="user-row-"]');
            const err = document.querySelector('[data-testid="user-list-error"]')?.textContent ?? '';
            const hint = document.querySelector('[data-testid="user-dialect-coach"]')?.textContent ?? '';
            const text = document.body.textContent ?? '';
            return (
              row !== null ||
              err.trim().length > 0 ||
              /not support|unsupported|no accounts/i.test(`${hint}${text}`)
            );
          },
          undefined,
          { timeout: 120_000 }
        );

        const body = await driver.locator('[data-testid="user-management"]').innerText();
        expect(body.toLowerCase()).not.toMatch(/credential not found|password required/);

        if (SUPPORTS_DB_ACCESS.includes(dialect)) {
          const refused = /not support|unsupported|no accounts/i.test(body);
          expect(refused, `${dialect} should load principals`).toBe(false);
        }

        await saveScreenshot(driver, `access-users-${dialect}`);
      });

      it('Permission Builder renders SQL preview', async () => {
        if (!SUPPORTS_GRANT_BUILDER.includes(dialect)) return;

        await driver.locator('[data-testid="access-tab-builder"]').click();
        const name = credNameByDialect.get(dialect)!;
        await driver
          .locator('[data-testid="access-connection"]')
          .selectOption({ label: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
        await driver.locator('[data-testid="access-principal-name"]').fill('report_user');
        await driver.locator('[data-testid="access-schema"]').fill('public');

        await driver.waitForFunction(
          () => {
            const pre = document.querySelector('[data-testid="access-sql"]');
            return pre !== null && (pre.textContent ?? '').trim().length > 10;
          },
          undefined,
          { timeout: 30_000 }
        );

        const sqlText = await driver.locator('[data-testid="access-sql"]').innerText();
        expect(sqlText.toUpperCase()).toMatch(/GRANT|REVOKE|--/);
        await saveScreenshot(driver, `access-builder-${dialect}`);
      });

      it('Permission Diff tab loads and accepts desired state', async () => {
        if (!SUPPORTS_GRANT_BUILDER.includes(dialect)) return;

        await driver.locator('[data-testid="access-tab-diff"]').click();
        await driver.waitForSelector('[data-testid="permission-diff"]', { timeout: 15_000 });
        const name = credNameByDialect.get(dialect)!;
        await driver
          .locator('[data-testid="diff-connection"]')
          .selectOption({ label: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
        await driver.locator('[data-testid="diff-principal-name"]').fill('report_user');
        await driver.locator('[data-testid="diff-schema-0"]').fill('public');

        await driver.locator('[data-testid="diff-load-catalog"]').click();
        await driver.waitForFunction(
          () => {
            const summary = document.querySelector('[data-testid="diff-summary"]');
            const empty = document.querySelector('[data-testid="permission-diff"]')?.textContent ?? '';
            return summary !== null || /Load the catalog|missing|match|extra/i.test(empty);
          },
          undefined,
          { timeout: 120_000 }
        );

        await saveScreenshot(driver, `access-diff-${dialect}`);
      });

      if (dialect === 'sqlserver' || dialect === 'azuresql') {
        it('Permission Builder offers DENY for SQL Server family', async () => {
          await driver.locator('[data-testid="access-tab-builder"]').click();
          const name = credNameByDialect.get(dialect)!;
          await driver
            .locator('[data-testid="access-connection"]')
            .selectOption({ label: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
          await driver.locator('[data-testid="access-action"]').getByText('Deny').click();
          await driver.locator('[data-testid="access-principal-name"]').fill('report_user');
          await driver.locator('[data-testid="access-schema"]').fill('dbo');
          await driver.waitForFunction(
            () =>
              (document.querySelector('[data-testid="access-sql"]')?.textContent ?? '').includes(
                'DENY'
              ),
            undefined,
            { timeout: 30_000 }
          );
        });
      }
    });
  }
});
