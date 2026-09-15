import type { Page } from 'playwright';
import { clickWhen, waitFor } from '../helpers/driver.js';

/**
 * Workflow workspace (activity rail → Workflow).
 * Local single-user boots as admin, so every pane tab is visible.
 */
export class WorkflowPage {
  constructor(private page: Page) {}

  async openView(): Promise<void> {
    await clickWhen(this.page, '[data-testid="view-workflow-btn"]');
    await waitFor(this.page, '[data-testid="workflow-view"]', 20_000);
  }

  async openTab(
    tab: 'designer' | 'workflows' | 'runs' | 'variables' | 'credentials' | 'engine',
  ): Promise<void> {
    await clickWhen(this.page, `[data-testid="workflow-tab-${tab}"]`);
  }

  tab(tab: string) {
    return this.page.locator(`[data-testid="workflow-tab-${tab}"]`);
  }
}
