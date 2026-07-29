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

  /** Expand TABLES group and open the blueprint for a table by name. */
  async openTableBlueprint(tableName: string): Promise<void> {
    await this.dismissOverlays();
    await this.closeBlueprint().catch(() => undefined);
    const explorer = this.page.locator('[data-testid="sql-schema-explorer"]');
    await explorer.waitFor({ state: 'visible', timeout: 15_000 });
    // Expand TABLES group only when the table name is not already visible
    // (a second click would collapse it).
    const alreadyVisible = await explorer.getByText(tableName, { exact: true }).count();
    if (alreadyVisible === 0) {
      const group = explorer.locator('[data-testid="sql-schema-group-TABLE"]');
      if (await group.count()) {
        await group.locator('button').first().click().catch(() => undefined);
      }
    }
    await this.page.waitForFunction(
      (name) => {
        const root = document.querySelector('[data-testid="sql-schema-explorer"]');
        return !!root && new RegExp(name, 'i').test(root.textContent ?? '');
      },
      tableName,
      { timeout: 45_000 }
    );
    // Edit sits on the right of the object row (always visible).
    const nameLabel = explorer.getByText(tableName, { exact: true }).first();
    await nameLabel.scrollIntoViewIfNeeded();
    const row = nameLabel.locator('xpath=ancestor::div[./button[@data-testid="sql-open-blueprint"] or .//button[@data-testid="sql-open-blueprint"]][1]');
    await row.locator('[data-testid="sql-open-blueprint"]').click({ force: true });
    await waitFor(this.page, '[data-testid="table-blueprint-modal"]', 15_000);
  }

  async openNewTableBlueprint(): Promise<void> {
    await this.dismissOverlays();
    // Prefer Schema header action; fall back to explorer New control.
    const header = this.page.locator('[data-testid="sql-schema-new-table"]');
    if (await header.count()) {
      await header.click();
    } else {
      await clickWhen(this.page, '[data-testid="sql-new-table"]');
    }
    await waitFor(this.page, '[data-testid="table-blueprint-modal"]', 15_000);
  }

  async blueprintInsertSql(): Promise<void> {
    await clickWhen(this.page, '[data-testid="blueprint-insert-sql"]');
  }

  async closeBlueprint(): Promise<void> {
    const modal = this.page.locator('[data-testid="table-blueprint-modal"]');
    if (!(await modal.isVisible().catch(() => false))) return;
    const closeBtn = this.page.locator('[data-testid="blueprint-close"]');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      // Click the backdrop (outer modal shell closes on click).
      await modal.click({ position: { x: 4, y: 4 } });
    }
    await modal.waitFor({ state: 'detached', timeout: 8_000 });
  }

  async clickPageNext(): Promise<void> {
    await clickWhen(this.page, '[data-testid="sql-page-next"]');
  }

  async clickPagePrev(): Promise<void> {
    await clickWhen(this.page, '[data-testid="sql-page-prev"]');
  }

  async pageNextEnabled(): Promise<boolean> {
    const btn = this.page.locator('[data-testid="sql-page-next"]');
    if (!(await btn.isVisible().catch(() => false))) return false;
    return !(await btn.isDisabled());
  }

  /** Wipe persisted editor tabs so tests start from a clean Query 1. */
  async resetPersistedEditorState(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.removeItem('foxschema-sql-editor');
    });
  }
}
