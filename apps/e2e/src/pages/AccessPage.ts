import type { Page } from 'playwright';
import { clickWhen, waitFor } from '../helpers/driver.js';

/**
 * Database Access Assistant (toolbar → Access) plus the SQL Editor
 * Utilities → Database Access modal.
 */
export class AccessPage {
  constructor(private page: Page) {}

  async openView(): Promise<void> {
    await clickWhen(this.page, '[data-testid="view-access-btn"]');
    await waitFor(this.page, '[data-testid="access-view"]', 20_000);
  }

  async openTab(tab: 'users' | 'builder' | 'diff' | 'inspector' | 'report'): Promise<void> {
    await clickWhen(this.page, `[data-testid="access-tab-${tab}"]`);
  }

  /** Pick a saved credential in any Access / Database Access <select> by visible name. */
  async selectConnection(selectTestId: string, nameSubstring: string): Promise<void> {
    const select = this.page.locator(`[data-testid="${selectTestId}"]`);
    await select.waitFor({ state: 'visible', timeout: 10_000 });
    const value = await select.evaluate((el, want) => {
      const sel = el as HTMLSelectElement;
      const opt = [...sel.options].find((o) =>
        o.textContent?.toLowerCase().includes(want.toLowerCase())
      );
      return opt?.value ?? '';
    }, nameSubstring);
    if (!value) {
      throw new Error(`No option matching "${nameSubstring}" in [data-testid="${selectTestId}"]`);
    }
    await select.selectOption(value);
  }
}
