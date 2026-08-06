import type { Page } from 'playwright';
import { clickWhen, waitFor, fillInput } from '../helpers/driver.js';
import type { DbConfig } from '../helpers/db-config.js';
import { ConnectionModal } from './ConnectionModal.js';

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
    await this.addCredential(name, {
      dialect: 'sqlite',
      host: 'localhost',
      port: 0,
      database: dbPath,
      username: 'unused',
      password: 'unused',
    });
  }

  /**
   * Save any dialect credential from Credentials → Add.
   * Fills the connection name, then reuses ConnectionModal.connect() (load schemas + save password).
   */
  async addCredential(name: string, cfg: DbConfig): Promise<void> {
    await this.openCredentials();
    await clickWhen(this.page, '[data-testid="cred-add-btn"]');
    await waitFor(this.page, '[data-testid="conn-modal"]');
    const modal = new ConnectionModal(this.page);
    // Dialect first — switching dialect can reset the form and wipe the name.
    await modal.selectDialect(cfg.dialect);
    await fillInput(this.page, '[data-testid="conn-name-input"]', name);
    await modal.fillHost(cfg.host);
    await modal.fillPort(cfg.port);
    await modal.fillDatabase(cfg.database);
    await modal.fillUsername(cfg.username);
    await modal.fillPassword(cfg.password);
    await modal.checkSavePassword();
    // loadSchemas throws on conn-test-failed — never persist a bad credential.
    await modal.loadSchemas();
    if (cfg.schema) await modal.selectSchema(cfg.schema);
    await modal.save();
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

  /** Editor text (rendered lines + hidden textarea), whitespace-normalised for matching. */
  async editorText(): Promise<string> {
    const raw = await this.page.evaluate(() => {
      const lines = document.querySelector('.monaco-editor .view-lines');
      const ta = document.querySelector('.monaco-editor textarea') as HTMLTextAreaElement | null;
      return `${lines?.textContent ?? ''}\n${ta?.value ?? ''}`;
    });
    return raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  }

  private columnPicker() {
    return this.page.locator('[data-testid="sql-select-column-picker"]');
  }

  /**
   * Open the SELECT column picker the way a user does — click the SELECT/FROM
   * keyword in the editor. Falls back to the CtrlCmd+Shift+C shortcut when the
   * token click doesn't land (Monaco re-tokenises while typing).
   */
  async openColumnPicker(): Promise<void> {
    await this.dismissOverlays();
    // Dismiss any open autocomplete so the click reaches the keyword.
    await this.page.keyboard.press('Escape');
    const keyword = this.page
      .locator('.monaco-editor .view-line span span')
      .filter({ hasText: /^(SELECT|FROM)$/i })
      .first();
    if (await keyword.count()) {
      await keyword.click({ force: true }).catch(() => undefined);
    }
    if (await this.columnPicker().isVisible().catch(() => false)) {
      await this.page.waitForTimeout(250);
      return;
    }
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.locator('.monaco-editor').first().click();
    await this.page.keyboard.press(`${mod}+Shift+KeyC`);
    await this.columnPicker().waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.waitForTimeout(250);
  }

  async columnPickerVisible(): Promise<boolean> {
    return this.columnPicker().isVisible().catch(() => false);
  }

  /**
   * Teardown close via the header X. Deliberately not Escape or an outside
   * click — those are under test, and using them here would let one broken
   * dismiss path cascade into unrelated failures.
   */
  async closeColumnPicker(): Promise<void> {
    if (!(await this.columnPickerVisible())) return;
    await this.columnPicker().locator('button[aria-label="Close"]').click();
    await this.columnPicker().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
  }

  /** Click somewhere outside the picker that cannot mutate the query (the active tab). */
  async clickOutsideColumnPicker(): Promise<void> {
    await this.page.locator('[data-testid="sql-editor-tabs"] [role="tab"]').first().click();
  }

  async pickerColumnLabels(): Promise<string[]> {
    return this.columnPicker().locator('li label span').allInnerTexts();
  }

  async pickerStatusText(): Promise<string> {
    return this.columnPicker().innerText();
  }

  async pickerSelectAllStar(): Promise<void> {
    await this.columnPicker().locator('[data-testid="sql-select-all-star"]').click();
    await this.page.waitForTimeout(300);
  }

  async pickerRemoveAll(): Promise<void> {
    await this.columnPicker().locator('[data-testid="sql-select-remove-all"]').click();
    await this.page.waitForTimeout(300);
  }

  /** Toggle one `alias.column` checkbox by its expression (case-insensitive testid). */
  async pickerToggleColumn(expr: string): Promise<void> {
    const box = this.columnPicker().locator(
      `[data-testid="sql-select-col-${expr.toLowerCase()}"]`
    );
    await box.waitFor({ state: 'visible', timeout: 10_000 });
    await box.click();
    await this.page.waitForTimeout(300);
  }

  async pickerColumnChecked(expr: string): Promise<boolean> {
    return this.columnPicker()
      .locator(`[data-testid="sql-select-col-${expr.toLowerCase()}"]`)
      .isChecked();
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
      localStorage.removeItem('foxschema-sql-sidebar-sections');
      localStorage.removeItem('foxschema-sql-sidebar-section-heights');
      localStorage.removeItem('foxschema-sql-sidebar-order');
    });
  }

  /** Ensure a sidebar section is expanded (Destinations / Utilities / Schema / …). */
  async ensureSidebarSectionOpen(id: string): Promise<void> {
    await this.dismissOverlays();
    const section = this.page.locator(`[data-testid="sql-sidebar-${id}"]`);
    await section.waitFor({ state: 'visible', timeout: 10_000 });
    const toggle = this.page.locator(`[data-testid="sql-sidebar-toggle-${id}"]`);
    // Content for utilities is the Index Management button.
    const openProbe =
      id === 'utilities'
        ? section.locator('[data-testid="utilities-index-management"]')
        : section.locator(`[data-testid="sql-sidebar-${id}"] >> visible=true`);
    if (id === 'utilities') {
      if (await section.locator('[data-testid="utilities-index-management"]').isVisible().catch(() => false)) {
        return;
      }
      await toggle.click();
      await section.locator('[data-testid="utilities-index-management"]').waitFor({
        state: 'visible',
        timeout: 5_000,
      });
      return;
    }
    void openProbe;
    // Generic: if toggle says collapsed, click once.
    const aria = await toggle.getAttribute('aria-expanded').catch(() => null);
    if (aria === 'false') await toggle.click();
  }

  /** Open Data Peek for a table from the Schema tree (modifier-click the row). */
  async openDataPeek(tableName: string): Promise<void> {
    await this.dismissOverlays();
    const explorer = this.page.locator('[data-testid="sql-schema-explorer"]');
    await explorer.waitFor({ state: 'visible', timeout: 15_000 });
    await this.page.waitForFunction(
      (name) => {
        const root = document.querySelector('[data-testid="sql-schema-explorer"]');
        return !!root && new RegExp(name, 'i').test(root.textContent ?? '');
      },
      tableName,
      { timeout: 60_000 }
    );
    const label = explorer.getByText(tableName, { exact: true }).first();
    await label.scrollIntoViewIfNeeded();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await label.click({ modifiers: [modifier] });
    await waitFor(this.page, '[data-testid="data-peek"]', 30_000);
    // Wait for the grid, since the CRUD controls only render once rows load.
    await this.page.waitForSelector('[data-testid^="data-peek-crud-"]', { timeout: 30_000 });
  }

  /** Click Add row on the first open Data Peek panel. */
  async openPeekAddRow(): Promise<void> {
    await this.page.locator('[data-testid^="data-peek-add-"]').first().click();
    await waitFor(this.page, '[data-testid="peek-row-editor"]', 10_000);
  }

  async openIndexManagement(): Promise<void> {
    await this.ensureSidebarSectionOpen('utilities');
    await clickWhen(this.page, '[data-testid="utilities-index-management"]');
    await waitFor(this.page, '[data-testid="index-management-modal"]', 15_000);
  }

  async openServerInsights(
    tab: 'pool' | 'sessions' | 'system' | 'sizes' = 'system'
  ): Promise<void> {
    await this.ensureSidebarSectionOpen('utilities');
    const testId =
      tab === 'pool'
        ? 'utilities-connection-pool'
        : tab === 'sessions'
          ? 'utilities-user-connections'
          : tab === 'system'
            ? 'utilities-system-info'
            : 'utilities-object-sizes';
    await clickWhen(this.page, `[data-testid="${testId}"]`);
    await waitFor(this.page, '[data-testid="server-insights-modal"]', 15_000);
    await waitFor(this.page, `[data-testid="server-insights-tab-${tab}"]`, 5_000);
  }

  async closeServerInsights(): Promise<void> {
    const modal = this.page.locator('[data-testid="server-insights-modal"]');
    if (!(await modal.isVisible().catch(() => false))) return;
    await modal.locator('button[aria-label="Close"]').click().catch(async () => {
      await this.page.keyboard.press('Escape');
    });
    await modal.waitFor({ state: 'detached', timeout: 8_000 }).catch(() => undefined);
  }

  async closeIndexManagement(): Promise<void> {
    const modal = this.page.locator('[data-testid="index-management-modal"]');
    if (!(await modal.isVisible().catch(() => false))) return;
    await modal.locator('button[aria-label="Close"]').click().catch(async () => {
      await modal.click({ position: { x: 4, y: 4 } });
    });
    await modal.waitFor({ state: 'detached', timeout: 8_000 }).catch(() => undefined);
  }

  async openCloneTable(): Promise<void> {
    await this.dismissOverlays();
    await this.ensureSidebarSectionOpen('utilities');
    await clickWhen(this.page, '[data-testid="utilities-clone-table"]');
    await waitFor(this.page, '[data-testid="clone-table-modal"]', 15_000);
  }

  async closeCloneTable(): Promise<void> {
    const modal = this.page.locator('[data-testid="clone-table-modal"]');
    if (!(await modal.isVisible().catch(() => false))) return;
    await modal.locator('button[aria-label="Close"]').click().catch(async () => {
      await modal.getByRole('button', { name: /^close$/i }).click();
    });
    await modal.waitFor({ state: 'detached', timeout: 8_000 }).catch(() => undefined);
  }

  /** Pick credential in Clone Table / Index Management by visible name substring. */
  async selectUtilityConnection(nameSubstring: string, selectTestId: string): Promise<void> {
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
      throw new Error(`No credential option matching "${nameSubstring}" in ${selectTestId}`);
    }
    await select.selectOption(value);
  }

  async waitForCloneTableOption(tableName: string, timeoutMs = 30_000): Promise<void> {
    await this.page.waitForFunction(
      (name) => {
        const sel = document.querySelector(
          '[data-testid="clone-table-name"]'
        ) as HTMLSelectElement | null;
        return !!sel && [...sel.options].some((o) => o.value === name);
      },
      tableName,
      { timeout: timeoutMs }
    );
  }

  async loadCloneTables(connectionName: string, tableName: string): Promise<void> {
    await this.selectUtilityConnection(connectionName, 'clone-table-connection');
    await this.page.locator('[data-testid="clone-table-load"]').click();
    await this.page.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="clone-status"]')?.textContent ?? '';
        const err = document.querySelector('[data-testid="clone-error"]')?.textContent ?? '';
        const sel = document.querySelector(
          '[data-testid="clone-table-name"]'
        ) as HTMLSelectElement | null;
        const opts = sel ? [...sel.options].map((o) => o.value).filter(Boolean) : [];
        return err.length > 0 || /loaded/i.test(status) || opts.length > 0;
      },
      { timeout: 45_000 }
    );
    const debug = await this.page.evaluate(() => {
      const status = document.querySelector('[data-testid="clone-status"]')?.textContent ?? '';
      const err = document.querySelector('[data-testid="clone-error"]')?.textContent ?? '';
      const sel = document.querySelector(
        '[data-testid="clone-table-name"]'
      ) as HTMLSelectElement | null;
      const opts = sel
        ? [...sel.options].map((o) => ({ value: o.value, label: o.textContent }))
        : [];
      return { status, err, opts };
    });
    if (debug.err.trim()) throw new Error(`Clone Table load failed: ${debug.err}`);
    if (!debug.opts.some((o) => o.value === tableName)) {
      throw new Error(
        `Clone Table missing option "${tableName}". status=${debug.status} opts=${JSON.stringify(debug.opts)}`
      );
    }
    await this.page.locator('[data-testid="clone-table-name"]').selectOption(tableName);
  }
}
