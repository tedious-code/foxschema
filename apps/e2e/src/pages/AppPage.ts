import { WebDriver, By, until } from 'selenium-webdriver';
import { BASE_URL, waitFor, clickWhen } from '../helpers/driver.js';

/**
 * Page object for the main FoxSchema comparison workspace.
 * All selectors match the data-testid attributes set in the React components.
 */
export class AppPage {
  constructor(private driver: WebDriver) {}

  async open(): Promise<void> {
    await this.driver.get(BASE_URL);
    await waitFor(this.driver, By.css('[data-testid="toolbar"]'));
  }

  // ── Source side ─────────────────────────────────────────────────────────

  async openSourceModal(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="source-config-btn"]'));
    await waitFor(this.driver, By.css('[data-testid="conn-modal"]'));
  }

  async isSourceConnected(): Promise<boolean> {
    const els = await this.driver.findElements(By.css('[data-testid="source-connected-btn"]'));
    return els.length > 0;
  }

  async waitForSourceConnected(timeoutMs = 15_000): Promise<void> {
    await this.driver.wait(
      until.elementLocated(By.css('[data-testid="source-connected-btn"]')),
      timeoutMs
    );
  }

  // ── Target side ─────────────────────────────────────────────────────────

  async openTargetModal(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="target-config-btn"]'));
    await waitFor(this.driver, By.css('[data-testid="conn-modal"]'));
  }

  async isTargetConnected(): Promise<boolean> {
    const els = await this.driver.findElements(By.css('[data-testid="target-connected-btn"]'));
    return els.length > 0;
  }

  async waitForTargetConnected(timeoutMs = 15_000): Promise<void> {
    await this.driver.wait(
      until.elementLocated(By.css('[data-testid="target-connected-btn"]')),
      timeoutMs
    );
  }

  // ── Comparison ─────────────────────────────────────────────────────────

  async runCompare(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="compare-btn"]'));
    await this.driver.wait(
      until.elementLocated(By.css('[data-testid="schema-tree"]')),
      30_000
    );
  }

  async getDiffCount(): Promise<number> {
    const items = await this.driver.findElements(By.css('[data-testid="diff-item"]'));
    return items.length;
  }

  async getDiffStatuses(): Promise<(string | null)[]> {
    const items = await this.driver.findElements(By.css('[data-testid="diff-item"]'));
    return Promise.all(items.map((el) => el.getAttribute('data-status')));
  }

  async isSchemaTreeVisible(): Promise<boolean> {
    try {
      const el = await waitFor(this.driver, By.css('[data-testid="schema-tree"]'), 3_000);
      return el.isDisplayed();
    } catch {
      return false;
    }
  }

  // ── Banners ────────────────────────────────────────────────────────────

  async isErrorBannerVisible(): Promise<boolean> {
    const els = await this.driver.findElements(By.css('[data-testid="error-banner"]'));
    return els.length > 0 && els[0].isDisplayed();
  }

  async getErrorBannerText(): Promise<string> {
    const el = await waitFor(this.driver, By.css('[data-testid="error-banner"]'));
    return el.getText();
  }

  async isWarningBannerVisible(): Promise<boolean> {
    const els = await this.driver.findElements(By.css('[data-testid="warning-banner"]'));
    return els.length > 0 && els[0].isDisplayed();
  }

  async dismissWarnings(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="dismiss-warnings-btn"]'));
  }
}
