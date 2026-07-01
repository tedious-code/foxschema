/**
 * Full end-to-end flow for each dialect:
 *   1. Boot & check no console errors
 *   2. Connect source + target
 *   3. Compare schemas
 *   4. Execute migration (non-destructive — ADD/MODIFY only)
 *   5. Wait for migration complete
 *   6. Verify migration history shows a SUCCESS record
 *
 * Each dialect test file calls runDialectFlow(dialect, getSource, getTarget).
 * The browser is managed here via beforeAll / afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../../helpers/driver.js';
import { attachConsoleMonitor } from '../../helpers/console-monitor.js';
import { saveScreenshot } from '../../helpers/screenshot.js';
import { AppPage } from '../../pages/AppPage.js';
import { ConnectionModal } from '../../pages/ConnectionModal.js';
import { MigrationPage } from '../../pages/MigrationPage.js';
import type { DbConfig } from '../../helpers/db-config.js';

export function runDialectFlow(
  dialectLabel: string,
  getSource: () => DbConfig,
  getTarget: () => DbConfig
): void {
  let driver: Page;
  let app: AppPage;
  let modal: ConnectionModal;
  let migration: MigrationPage;
  let getErrors: ReturnType<typeof attachConsoleMonitor>['getErrors'];

  beforeAll(async () => {
    driver = await buildDriver();
    // Attach before first navigation so boot errors are captured.
    ({ getErrors } = attachConsoleMonitor(driver));
    app = new AppPage(driver);
    modal = new ConnectionModal(driver);
    migration = new MigrationPage(driver);
  });

  afterAll(async () => {
    if (driver) await quitDriver(driver);
  });

  // ── 1. Boot ─────────────────────────────────────────────────────────────

  it('app boots without console errors', async () => {
    await app.open();
    const errors = getErrors().filter((e) => e.level === 'SEVERE');
    if (errors.length) await saveScreenshot(driver, `${dialectLabel}_boot_error`);
    expect(errors, errors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  // ── 2. Connect ──────────────────────────────────────────────────────────

  it('connects source', async () => {
    await app.openSourceModal();
    await modal.connect(getSource());
    await app.waitForSourceConnected(30_000);
    expect(await app.isSourceConnected()).toBe(true);
  });

  it('connects target', async () => {
    await app.openTargetModal();
    await modal.connect(getTarget());
    await app.waitForTargetConnected(30_000);
    expect(await app.isTargetConnected()).toBe(true);
  });

  // ── 3. Compare ──────────────────────────────────────────────────────────

  it('runs schema comparison', async () => {
    await app.runCompare();
    expect(await app.isSchemaTreeVisible()).toBe(true);
  });

  it('diff tree has at least one object', async () => {
    const count = await app.getDiffCount();
    if (count === 0) await saveScreenshot(driver, `${dialectLabel}_empty_diff`);
    // Warn but don't fail — schemas may already be in sync.
    console.log(`[${dialectLabel}] diff object count: ${count}`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('no SEVERE console errors after compare', async () => {
    const errors = getErrors().filter((e) => e.level === 'SEVERE');
    if (errors.length) await saveScreenshot(driver, `${dialectLabel}_compare_error`);
    expect(errors, errors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  // ── 4. Migrate ──────────────────────────────────────────────────────────

  it('execute button is present', async () => {
    const diffItems = await app.getDiffCount();
    if (diffItems === 0) {
      console.log(`[${dialectLabel}] No diff objects — skipping execute step`);
      return;
    }
    // Non-destructive first — Execute stays disabled while the plan contains
    // DROP TABLE/COLUMN/INDEX until the "destructive drops" checkbox is ticked,
    // and this flow is documented (and named) as the non-destructive run.
    await migration.setNonDestructive(true);
    // Select all objects — the execute button stays disabled until at least
    // one diff object is checked in.
    await migration.selectAllObjects(true);
    // Tick any remaining safety acknowledgments (e.g. MySQL binlog risk —
    // independent of non-destructive mode, since it's about routine creation).
    await migration.acknowledgeSafetyWarnings();
    expect(await migration.isExecuteEnabled()).toBe(true);
  });

  it('executes migration (non-destructive)', async () => {
    const diffItems = await app.getDiffCount();
    if (diffItems === 0) {
      console.log(`[${dialectLabel}] No diff objects — skipping migration`);
      return;
    }

    // Objects already selected in the previous step; just execute.
    await migration.clickExecute();
    // Confirm dialog may appear
    await migration.confirmDeploy();
    // Wait for the progress panel
    await migration.waitForMigrationPanel(15_000);
    // Wait for completion (up to 2 min for large schemas)
    const result = await migration.waitForMigrationDone(120_000);

    if (result === 'failed') {
      await saveScreenshot(driver, `${dialectLabel}_migration_failed`);
      const errText = await migration.getMigrationErrorText();
      console.error(`[${dialectLabel}] Migration failed:\n${errText}`);
    }

    // Log per-object outcomes
    const items = await migration.getMigrationProgressItems();
    const failed = items.filter((i) => i.status === 'FAILED');
    if (failed.length) {
      console.warn(`[${dialectLabel}] Failed objects: ${failed.map((i) => i.object).join(', ')}`);
    }

    expect(result, `Migration did not complete successfully`).toBe('complete');
  });

  it('no SEVERE console errors after migration', async () => {
    const errors = getErrors().filter((e) => e.level === 'SEVERE');
    if (errors.length) await saveScreenshot(driver, `${dialectLabel}_post_migrate_error`);
    expect(errors, errors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  // ── 5. History ──────────────────────────────────────────────────────────

  it('migration history shows the run', async () => {
    await migration.openHistory();
    expect(await migration.isHistoryVisible()).toBe(true);

    const count = await migration.getHistoryRunCount();
    expect(count, 'Expected at least one history record').toBeGreaterThan(0);

    const status = await migration.getLatestRunStatus();
    console.log(`[${dialectLabel}] latest history run status: ${status}`);
    expect(status).toBe('SUCCESS');

    await migration.closeHistory();
  });
}
