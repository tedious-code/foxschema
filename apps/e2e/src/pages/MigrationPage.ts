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

  async closeHistory(): Promise<void> {
    await this.page.locator('[data-testid="history-dialog"] > div button:last-child').click();
    await this.page.waitForSelector('[data-testid="history-dialog"]', {
      state: 'detached',
      timeout: 5_000,
    });
  }
}
