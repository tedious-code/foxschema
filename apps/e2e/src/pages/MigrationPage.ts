import { WebDriver, By, until } from 'selenium-webdriver';
import { waitFor, clickWhen } from '../helpers/driver.js';

/**
 * Page object covering the execute → progress → history flow.
 */
export class MigrationPage {
  constructor(private driver: WebDriver) {}

  // ── Select-all checkbox in the schema tree panel ────────────────────────

  /** Check/uncheck the global "Deploy to Target" checkbox in the tree header. */
  async selectAllObjects(check: boolean): Promise<void> {
    const cb = await waitFor(this.driver, By.css('[data-testid="schema-tree"] input[type="checkbox"]'));
    const current = await cb.isSelected();
    if (current !== check) await cb.click();
  }

  // ── Execute button ──────────────────────────────────────────────────────

  async clickExecute(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="execute-btn"]'));
  }

  async isExecuteEnabled(): Promise<boolean> {
    const btn = await waitFor(this.driver, By.css('[data-testid="execute-btn"]'));
    const disabled = await btn.getAttribute('disabled');
    return disabled === null;
  }

  // ── Confirm dialog ─────────────────────────────────────────────────────

  async isConfirmDialogVisible(): Promise<boolean> {
    const els = await this.driver.findElements(By.css('[data-testid="deploy-confirm-dialog"]'));
    return els.length > 0 && els[0].isDisplayed();
  }

  async confirmDeploy(): Promise<void> {
    // Confirm dialog may or may not appear (user can suppress it).
    const els = await this.driver.findElements(By.css('[data-testid="deploy-confirm-dialog"]'));
    if (els.length > 0 && await els[0].isDisplayed()) {
      await clickWhen(this.driver, By.css('[data-testid="deploy-confirm-btn"]'));
    }
  }

  // ── Migration progress panel ───────────────────────────────────────────

  async waitForMigrationPanel(timeoutMs = 10_000): Promise<void> {
    await this.driver.wait(
      until.elementLocated(By.css('[data-testid="migration-progress-panel"]')),
      timeoutMs
    );
  }

  /** Wait until migration finishes (complete or failed). Returns 'complete' | 'failed'. */
  async waitForMigrationDone(timeoutMs = 120_000): Promise<'complete' | 'failed'> {
    await this.driver.wait(
      until.elementLocated(
        By.css('[data-testid="migration-complete"], [data-testid="migration-failed"]')
      ),
      timeoutMs
    );
    const failed = await this.driver.findElements(By.css('[data-testid="migration-failed"]'));
    return failed.length > 0 ? 'failed' : 'complete';
  }

  async getMigrationProgressItems(): Promise<{ object: string | null; status: string | null }[]> {
    const items = await this.driver.findElements(By.css('[data-testid="migration-progress-item"]'));
    return Promise.all(items.map(async (el) => ({
      object: await el.getAttribute('data-object'),
      status: await el.getAttribute('data-status'),
    })));
  }

  async getMigrationErrorText(): Promise<string> {
    try {
      const panel = await waitFor(this.driver, By.css('[data-testid="migration-progress-panel"]'), 3_000);
      return panel.getText();
    } catch {
      return '';
    }
  }

  // ── History ────────────────────────────────────────────────────────────

  async openHistory(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="history-btn"]'));
    await waitFor(this.driver, By.css('[data-testid="history-dialog"]'));
  }

  async isHistoryVisible(): Promise<boolean> {
    const els = await this.driver.findElements(By.css('[data-testid="history-dialog"]'));
    return els.length > 0 && els[0].isDisplayed();
  }

  async getHistoryRunCount(): Promise<number> {
    const items = await this.driver.findElements(By.css('[data-testid="history-run-item"]'));
    return items.length;
  }

  async getLatestRunStatus(): Promise<string | null> {
    const items = await this.driver.findElements(By.css('[data-testid="history-run-item"]'));
    if (items.length === 0) return null;
    return items[0].getAttribute('data-status');
  }

  async closeHistory(): Promise<void> {
    // Click outside the dialog panel to close it
    await this.driver.findElement(By.css('[data-testid="history-dialog"]')).then(async (overlay) => {
      // Click the close button inside the dialog header
      const closeBtn = await this.driver.findElement(
        By.css('[data-testid="history-dialog"] > div button:last-child')
      );
      await closeBtn.click();
    });
    await this.driver.wait(async () => {
      const els = await this.driver.findElements(By.css('[data-testid="history-dialog"]'));
      return els.length === 0;
    }, 5_000);
  }
}
