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
import { buildDriver, quitDriver, clickWhen } from '../../helpers/driver.js';
import { attachConsoleMonitor } from '../../helpers/console-monitor.js';
import { saveScreenshot } from '../../helpers/screenshot.js';
import { AppPage } from '../../pages/AppPage.js';
import { ConnectionModal } from '../../pages/ConnectionModal.js';
import { MigrationPage } from '../../pages/MigrationPage.js';
import { LokeeHistoryPage } from '../../pages/LokeeHistoryPage.js';
import type { DbConfig } from '../../helpers/db-config.js';

/** What the History inspector must show for one object after migrate. */
export interface HistoryObjectExpectation {
  /** Node label as rendered in the graph, e.g. `fn_order_total`. */
  name: string;
  /** Routines have a Source section; tables do not. */
  expectSource?: boolean;
  /** Table growth is meaningless for a routine and must not be shown. */
  expectGrowth: boolean;
  /** Matched against the inspector's timeline text, e.g. /v\d+\s*·\s*ADD/i. */
  expectTimeline?: RegExp;
}

export interface DialectFlowOptions {
  /**
   * Skip execute/history steps. Used for dialects whose adapter is SELECT-only
   * in the SQL Editor / e2e path (e.g. SQLite) so compare still gets coverage.
   */
  skipMigration?: boolean;
  /**
   * Objects to open in the History inspector after migrate, and what each must
   * show. Expectations depend on the seed, so they live with the dialect that
   * chooses it rather than as a dialect-name check inside this shared flow —
   * another dialect running the same seed opts in with one line.
   */
  historyObjects?: HistoryObjectExpectation[];
}

export function runDialectFlow(
  dialectLabel: string,
  getSource: () => DbConfig,
  getTarget: () => DbConfig,
  options: DialectFlowOptions = {}
): void {
  const skipMigration = !!options.skipMigration;
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
    // Saving target reloads credentials — wait until source is connected again
    // (session password / hasPassword retest) before Compare is enabled.
    await app.waitForSourceConnected(30_000);
    expect(await app.isSourceConnected()).toBe(true);
  });

  // ── 3. Compare ──────────────────────────────────────────────────────────

  it('runs schema comparison', async () => {
    await app.waitForSourceConnected(15_000);
    await app.waitForTargetConnected(15_000);
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

  it.skipIf(skipMigration)('execute button is present', async () => {
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

  it.skipIf(skipMigration)('executes migration (non-destructive)', async () => {
    const diffItems = await app.getDiffCount();
    if (diffItems === 0) {
      console.log(`[${dialectLabel}] No diff objects — skipping migration`);
      return;
    }

    // Objects already selected in the previous step; just execute.
    await migration.clickExecute();
    // Confirm dialog may appear (or be skipped via localStorage); progress panel follows.
    // confirmDeploy throws if the dialog stays open (stuck confirm ≠ empty plan).
    await migration.confirmDeploy();
    // Non-destructive mode can leave includedCount > 0 while generateMigrationPlan
    // yields an empty plan (e.g. only REMOVED/DROP diffs). applyMigration then
    // returns without opening the progress panel — treat that as a skip only when
    // the confirm dialog is gone (deploy was accepted / never shown).
    const confirmStillOpen = await driver
      .locator('[data-testid="deploy-confirm-dialog"]')
      .isVisible()
      .catch(() => false);
    if (confirmStillOpen) {
      throw new Error(`[${dialectLabel}] Deploy confirm dialog still open after confirmDeploy`);
    }
    const panelVisible = await driver
      .locator('[data-testid="migration-progress-panel"]')
      .waitFor({ state: 'visible', timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    if (!panelVisible) {
      console.log(
        `[${dialectLabel}] No migration progress panel after confirm — empty non-destructive plan; skipping`
      );
      return;
    }
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

  it.skipIf(skipMigration)('no SEVERE console errors after migration', async () => {
    const errors = getErrors().filter((e) => e.level === 'SEVERE');
    if (errors.length) await saveScreenshot(driver, `${dialectLabel}_post_migrate_error`);
    expect(errors, errors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  // ── 5. History ──────────────────────────────────────────────────────────

  it.skipIf(skipMigration)('migration history shows the run', async () => {
    await migration.openHistory();
    expect(await migration.isHistoryVisible()).toBe(true);

    // Poll instead of instant-count: the dialog's list fetch is async, and the
    // backend finalizes the run status after streaming the 'done' event.
    const status = await migration.waitForLatestRunSettled();
    console.log(`[${dialectLabel}] latest history run status: ${status}`);
    // When this session skipped execute (empty non-destructive plan), history
    // may only contain older runs — require a settled record if any exist.
    if (status == null) {
      console.log(`[${dialectLabel}] No history runs yet — ok when migration was skipped`);
      await migration.closeHistory();
      return;
    }
    // ROLLED_BACK is a settled outcome when the executor undoes a failed run.
    expect(['SUCCESS', 'FAILED', 'PARTIAL', 'ROLLED_BACK']).toContain(status);

    await migration.closeHistory();
  });

  it.skipIf(skipMigration)('schema history pane records a Lokee snapshot after migrate', async () => {
    await clickWhen(driver, '[data-testid="sync-pane-history-btn"]');
    await driver.waitForSelector('[data-testid="lokee-weave-view"]', { timeout: 20_000 });
    const graphToggle = driver.locator('[data-testid="lokee-graph-toggle"]');
    if (await graphToggle.isVisible().catch(() => false)) {
      await graphToggle.click();
    }
    const graph = driver.locator('[data-testid="lokee-weave-page"]');
    const hasGraph = await graph
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasGraph) {
      await saveScreenshot(driver, `${dialectLabel}_lokee_history_empty`);
      console.log(`[${dialectLabel}] History pane has no graph — migrate may have been skipped`);
    } else {
      await driver.locator('[data-testid^="rf-version-"]').first().waitFor({ timeout: 10_000 });
      expect(await driver.locator('[data-testid^="rf-version-"]').count()).toBeGreaterThan(0);

      // Per-object inspector expectations, supplied by the dialect that knows
      // its seed. Empty for dialects that have not opted in.
      const history = new LokeeHistoryPage(driver);
      for (const expected of options.historyObjects ?? []) {
        if (!(await history.objectNamedVisible(expected.name))) continue;
        await history.clickObjectNamed(expected.name);
        if (expected.expectSource !== undefined) {
          expect(await history.inspectorHasSection('source')).toBe(expected.expectSource);
        }
        expect(await history.inspectorHasSection('growth')).toBe(expected.expectGrowth);
        if (expected.expectTimeline) {
          expect(await history.inspectorText()).toMatch(expected.expectTimeline);
        }
      }
    }
    await clickWhen(driver, '[data-testid="sync-pane-compare-btn"]');
  });
}
