import type { Page } from 'playwright';
import { clickWhen, waitFor, fillInput } from '../helpers/driver.js';

/**
 * Page object for the SQL Editor workspace (view switcher + run against
 * saved credentials). Selectors match data-testid attributes in the React UI.
 */
export class SqlEditorPage {
  constructor(private page: Page) {}

  /** Dismiss session-password / write-confirm overlays that block clicks. */
  async dismissOverlays(): Promise<void> {
    const pwd = this.page.locator('[data-testid="sql-session-password"]');
    if (await pwd.isVisible().catch(() => false)) {
      await this.page.click('[data-testid="sql-session-password-cancel"]');
      await pwd.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    }
    const write = this.page.locator('[data-testid="sql-write-confirm"]');
    if (await write.isVisible().catch(() => false)) {
      // Cancel write confirm (backdrop click).
      await write.click({ position: { x: 8, y: 8 } });
      await write.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    }
    // First-run signup wizard (full-page, not a z-100 overlay).
    const skipSignup = this.page.getByRole('button', { name: /skip for now/i });
    if (await skipSignup.isVisible().catch(() => false)) {
      await skipSignup.click();
      await this.page.waitForTimeout(300);
    }
  }

  async openView(): Promise<void> {
    await clickWhen(this.page, '[data-testid="view-sql-editor-btn"]');
    await waitFor(this.page, '[data-testid="sql-editor-view"]');
    // Schema explorer may prompt for a password on auto-load — clear it so
    // later clicks aren't blocked. Callers that need the password should
    // submit via checkConnection / submitSessionPassword instead.
    await this.page.waitForTimeout(400);
    await this.dismissOverlays();
  }

  async isEditorVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="sql-editor-view"]').isVisible();
  }

  async openCredentials(): Promise<void> {
    await clickWhen(this.page, '[data-testid="credentials-btn"]');
    await waitFor(this.page, '[data-testid="cred-manager"]');
  }

  async closeCredentials(): Promise<void> {
    await clickWhen(this.page, '[data-testid="cred-close-btn"]');
    await this.page.waitForSelector('[data-testid="cred-manager"]', { state: 'detached', timeout: 10_000 });
  }

  /** Save a SQLite file path as a named credential (password saved so Run/schema don't re-prompt). */
  async addSqliteCredential(name: string, dbPath: string): Promise<void> {
    await this.openCredentials();
    await clickWhen(this.page, '[data-testid="cred-add-btn"]');
    await waitFor(this.page, '[data-testid="conn-modal"]');
    await fillInput(this.page, '[data-testid="conn-name-input"]', name);
    await this.page.selectOption('[data-testid="conn-dialect-select"]', 'sqlite');
    await fillInput(this.page, '[data-testid="conn-database-input"]', dbPath);
    // SQLite ignores the password, but hasPassword must be true so the SQL
    // Editor doesn't open a session-password modal on schema warm / check.
    await fillInput(this.page, '[data-testid="conn-password-input"]', 'unused');
    await this.page.locator('[data-testid="conn-save-password"]').check();
    await this.page.click('[data-testid="conn-load-schema-btn"]');
    await this.page.waitForSelector(
      '[data-testid="conn-test-success"], [data-testid="conn-test-failed"]',
      { timeout: 25_000 }
    );
    const failed = await this.page.locator('[data-testid="conn-test-failed"]').isVisible();
    if (failed) {
      const err = (await this.page.locator('[data-testid="conn-test-failed"]').textContent()) ?? 'load failed';
      throw new Error(`SQLite credential load failed for ${dbPath}: ${err}`);
    }
    await this.page.click('[data-testid="conn-save-btn"]');
    await this.page.waitForSelector('[data-testid="conn-modal"]', { state: 'detached', timeout: 10_000 });
    await this.closeCredentials();
  }

  async checkConnection(name: string): Promise<void> {
    const sel = `[data-testid="sql-conn-check-${name}"]`;
    await waitFor(this.page, sel, 15_000);
    const box = this.page.locator(sel);
    if (!(await box.isChecked())) await box.check();
  }

  async setSql(sql: string): Promise<void> {
    await this.dismissOverlays();
    // Monaco uses a hidden textarea; focus then replace via select-all + type.
    const editor = this.page.locator('.monaco-editor').first();
    await editor.click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${mod}+KeyA`);
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.type(sql, { delay: 8 });
    // Debounced gutter + store onChange (~200ms).
    await this.page.waitForTimeout(350);
  }

  async run(): Promise<void> {
    await this.dismissOverlays();
    await clickWhen(this.page, '[data-testid="sql-run-btn"]');
  }

  async waitForResults(timeoutMs = 30_000): Promise<void> {
    await this.page.waitForSelector(
      '[data-testid="sql-results-by-credential"], [data-testid="sql-results-side-by-side"]',
      { timeout: timeoutMs }
    );
  }

  async resultsText(): Promise<string> {
    const byCred = this.page.locator('[data-testid="sql-results-by-credential"]');
    const side = this.page.locator('[data-testid="sql-results-side-by-side"]');
    if (await byCred.isVisible()) return (await byCred.innerText()) ?? '';
    if (await side.isVisible()) return (await side.innerText()) ?? '';
    return '';
  }

  async addTab(): Promise<void> {
    await this.dismissOverlays();
    await clickWhen(this.page, '[data-testid="sql-tab-add"]');
  }

  async openSyncView(): Promise<void> {
    await this.dismissOverlays();
    await clickWhen(this.page, '[data-testid="view-sync-btn"]');
  }

  async setLayoutSideBySide(): Promise<void> {
    await this.dismissOverlays();
    await clickWhen(this.page, '[data-testid="sql-layout-side-by-side"]');
    await waitFor(this.page, '[data-testid="sql-results-side-by-side"]');
  }

  async setLayoutByCredential(): Promise<void> {
    await this.dismissOverlays();
    await clickWhen(this.page, '[data-testid="sql-layout-by-credential"]');
  }

  async tabCount(): Promise<number> {
    return this.page.locator('[data-testid="sql-editor-tabs"] [role="tab"]').count();
  }

  async statementStripVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="sql-statement-strip"]').isVisible();
  }

  async confirmWriteIfShown(): Promise<boolean> {
    const dlg = this.page.locator('[data-testid="sql-write-confirm"]');
    try {
      await dlg.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      return false;
    }
    await clickWhen(this.page, '[data-testid="sql-write-confirm-btn"]');
    await dlg.waitFor({ state: 'detached', timeout: 10_000 });
    return true;
  }

  async writeConfirmReadonlyWarnVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="sql-readonly-write-warn"]').isVisible();
  }

  async schemaExplorerVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="sql-schema-explorer"]').isVisible();
  }

  /** Wipe persisted editor tabs so tests start from a clean Query 1. */
  async resetPersistedEditorState(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.removeItem('foxschema-sql-editor');
    });
  }
}
