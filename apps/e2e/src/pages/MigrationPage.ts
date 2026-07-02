import type { Page } from 'playwright';
import { waitFor, clickWhen } from '../helpers/driver.js';

/**
 * Page object covering the execute → progress → history flow.
 */
export class MigrationPage {
  constructor(private page: Page) {}

  // ── Select-all checkbox in the schema tree panel ────────────────────────

  /** Check/uncheck the global "Deploy to Target" checkbox in the tree header. */
  async selectAllObjects(check: boolean): Promise<void> {
    const cb = this.page.locator('[data-testid="schema-tree"] input[type="checkbox"]').first();
    await cb.waitFor({ state: 'visible' });
    const current = await cb.isChecked();
    if (current !== check) await cb.click();
  }

  /** Check/uncheck the "No drops" (non-destructive) toggle in the tree header. */
  async setNonDestructive(check: boolean): Promise<void> {
    const cb = this.page.locator('[data-testid="non-destructive-checkbox"]');
    await cb.waitFor({ state: 'visible' });
    const current = await cb.isChecked();
    if (current !== check) await cb.click();
  }

  /**
   * Tick any safety-acknowledgment checkboxes currently rendered above the
   * Execute button (destructive drops, MySQL binlog risk). Each only renders
   * when its risk condition is active, so this is a no-op when absent —
   * safe to call unconditionally before every Execute click.
   */
  async acknowledgeSafetyWarnings(): Promise<void> {
    for (const testId of ['ack-destructive-drops', 'ack-mysql-binlog-risk']) {
      const cb = this.page.locator(`[data-testid="${testId}"]`);
      if (await cb.count() > 0 && !(await cb.isChecked())) {
        await cb.click();
      }
    }
  }

  // ── Execute button ──────────────────────────────────────────────────────

  async clickExecute(): Promise<void> {
    await clickWhen(this.page, '[data-testid="execute-btn"]');
  }

  async isExecuteEnabled(): Promise<boolean> {
    const btn = await waitFor(this.page, '[data-testid="execute-btn"]');
    return !(await btn.isDisabled());
  }

  // ── Confirm dialog ─────────────────────────────────────────────────────

  async isConfirmDialogVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="deploy-confirm-dialog"]').isVisible();
  }

  async confirmDeploy(): Promise<void> {
    const dialog = this.page.locator('[data-testid="deploy-confirm-dialog"]');
    if (await dialog.isVisible()) {
      await clickWhen(this.page, '[data-testid="deploy-confirm-btn"]');
    }
  }

  // ── Migration progress panel ───────────────────────────────────────────

  async waitForMigrationPanel(timeoutMs = 10_000): Promise<void> {
    await this.page.waitForSelector('[data-testid="migration-progress-panel"]', { timeout: timeoutMs });
  }

  /** Wait until migration finishes (complete or failed). Returns 'complete' | 'failed'. */
  async waitForMigrationDone(timeoutMs = 120_000): Promise<'complete' | 'failed'> {
    await this.page.waitForSelector(
      '[data-testid="migration-complete"], [data-testid="migration-failed"]',
      { timeout: timeoutMs }
    );
    const failed = await this.page.locator('[data-testid="migration-failed"]').count();
    return failed > 0 ? 'failed' : 'complete';
  }

  async getMigrationProgressItems(): Promise<{ object: string | null; status: string | null }[]> {
    const items = await this.page.locator('[data-testid="migration-progress-item"]').all();
    return Promise.all(items.map(async (el) => ({
      object: await el.getAttribute('data-object'),
      status: await el.getAttribute('data-status'),
    })));
  }

  async getMigrationErrorText(): Promise<string> {
    try {
      const panel = await waitFor(this.page, '[data-testid="migration-progress-panel"]', 3_000);
      return (await panel.textContent()) ?? '';
    } catch {
      return '';
    }
  }

  // ── History ────────────────────────────────────────────────────────────

  async openHistory(): Promise<void> {
    await clickWhen(this.page, '[data-testid="history-btn"]');
    await waitFor(this.page, '[data-testid="history-dialog"]');
  }

  async isHistoryVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="history-dialog"]').isVisible();
  }

  async getHistoryRunCount(): Promise<number> {
    return this.page.locator('[data-testid="history-run-item"]').count();
  }

  async getLatestRunStatus(): Promise<string | null> {
    return this.page.locator('[data-testid="history-run-item"]').first().getAttribute('data-status');
  }

  /**
   * Wait for the history list to actually settle. Two races otherwise:
   * the dialog's loadList() fetch is async (counting items right after the
   * dialog opens can see 0), and the backend writes the final run status
   * AFTER streaming the migration 'done' event (so the first fetch can see
   * the run still RUNNING). Polls until at least one item exists with a
   * terminal status; returns that status.
   */
  async waitForLatestRunSettled(timeoutMs = 10_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    let status: string | null = null;
    while (Date.now() < deadline) {
      if ((await this.getHistoryRunCount()) > 0) {
        status = await this.getLatestRunStatus();
        if (status && status !== 'RUNNING') return status;
      }
      // The dialog only fetches on open/refresh — nudge it so a late
      // history write still shows up within the polling window.
      await this.page.locator('[data-testid="history-dialog"] button[title="Refresh"]').click().catch(() => {});
      await this.page.waitForTimeout(500);
    }
    return status;
  }

  async closeHistory(): Promise<void> {
    await this.page.locator('[data-testid="history-dialog-close-btn"]').click();
    await this.page.waitForSelector('[data-testid="history-dialog"]', {
      state: 'detached',
      timeout: 5_000,
    });
  }
}
