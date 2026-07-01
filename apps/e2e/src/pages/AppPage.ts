import type { Page } from 'playwright';
import { BASE_URL, waitFor, clickWhen } from '../helpers/driver.js';

/**
 * Page object for the main FoxSchema comparison workspace.
 * All selectors match the data-testid attributes set in the React components.
 */
export class AppPage {
  constructor(private page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(BASE_URL);
    await waitFor(this.page, '[data-testid="toolbar"]');
  }

  // ── Source side ─────────────────────────────────────────────────────────

  async openSourceModal(): Promise<void> {
    await clickWhen(this.page, '[data-testid="source-config-btn"]');
    await waitFor(this.page, '[data-testid="conn-modal"]');
  }

  async isSourceConnected(): Promise<boolean> {
    return this.page.locator('[data-testid="source-connected-btn"]').isVisible();
  }

  async waitForSourceConnected(timeoutMs = 15_000): Promise<void> {
    await this.page.waitForSelector('[data-testid="source-connected-btn"]', { timeout: timeoutMs });
  }

  // ── Target side ─────────────────────────────────────────────────────────

  async openTargetModal(): Promise<void> {
    await clickWhen(this.page, '[data-testid="target-config-btn"]');
    await waitFor(this.page, '[data-testid="conn-modal"]');
  }

  async isTargetConnected(): Promise<boolean> {
    return this.page.locator('[data-testid="target-connected-btn"]').isVisible();
  }

  async waitForTargetConnected(timeoutMs = 15_000): Promise<void> {
    await this.page.waitForSelector('[data-testid="target-connected-btn"]', { timeout: timeoutMs });
  }

  // ── Comparison ─────────────────────────────────────────────────────────

  async runCompare(): Promise<void> {
    await clickWhen(this.page, '[data-testid="compare-btn"]');
    await this.page.waitForSelector('[data-testid="schema-tree"]', { timeout: 30_000 });
  }

  async getDiffCount(): Promise<number> {
    return this.page.locator('[data-testid="diff-item"]').count();
  }

  async getDiffStatuses(): Promise<(string | null)[]> {
    const items = await this.page.locator('[data-testid="diff-item"]').all();
    return Promise.all(items.map((el) => el.getAttribute('data-status')));
  }

  async isSchemaTreeVisible(): Promise<boolean> {
    try {
      await this.page.waitForSelector('[data-testid="schema-tree"]', { timeout: 3_000 });
      return this.page.locator('[data-testid="schema-tree"]').isVisible();
    } catch {
      return false;
    }
  }

  // ── Banners ────────────────────────────────────────────────────────────

  async isErrorBannerVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="error-banner"]').isVisible();
  }

  async getErrorBannerText(): Promise<string> {
    return (await this.page.locator('[data-testid="error-banner"]').textContent()) ?? '';
  }

  async isWarningBannerVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="warning-banner"]').isVisible();
  }

  async dismissWarnings(): Promise<void> {
    await clickWhen(this.page, '[data-testid="dismiss-warnings-btn"]');
  }
}
