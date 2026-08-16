/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Page object for Schema Sync → History (Lokee schema version graph).
 */
import type { Page } from 'playwright';
import { clickWhen, waitFor } from '../helpers/driver.js';

export class LokeeHistoryPage {
  constructor(private page: Page) {}

  async openHistoryPane(): Promise<void> {
    const historyView = this.page.locator('[data-testid="lokee-weave-view"]');
    if (await historyView.isVisible().catch(() => false)) return;
    const syncBtn = this.page.locator('[data-testid="view-sync-btn"]');
    if (await syncBtn.isVisible().catch(() => false)) {
      await clickWhen(this.page, '[data-testid="view-sync-btn"]');
    }
    await clickWhen(this.page, '[data-testid="sync-pane-history-btn"]');
    await waitFor(this.page, '[data-testid="lokee-weave-view"]', 20_000);
  }

  async openComparePane(): Promise<void> {
    await clickWhen(this.page, '[data-testid="sync-pane-compare-btn"]');
  }

  async snapshotTarget(): Promise<void> {
    const btn = this.page.locator('[data-testid="lokee-snapshot-target-btn"]');
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="lokee-snapshot-target-btn"]');
        return el instanceof HTMLButtonElement && !el.disabled;
      },
      { timeout: 15_000 }
    );
    await btn.click();
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="lokee-snapshot-target-btn"]');
        return (
          el instanceof HTMLButtonElement &&
          !el.disabled &&
          (el.textContent ?? '').includes('Snapshot target')
        );
      },
      { timeout: 30_000 }
    );
  }

  async waitForVersionCount(n: number, timeoutMs = 30_000): Promise<void> {
    await this.page.waitForFunction(
      (expected) => {
        const el = document.querySelector('[data-testid="lokee-summary"]');
        const text = el?.textContent ?? '';
        return new RegExp(`\\b${expected}\\s+versions?\\b`, 'i').test(text);
      },
      n,
      { timeout: timeoutMs }
    );
  }

  async waitForGraph(timeoutMs = 30_000): Promise<void> {
    await waitFor(this.page, '[data-testid="lokee-weave-page"]', timeoutMs);
    await this.page.locator('[data-testid^="rf-version-"]').first().waitFor({ timeout: timeoutMs });
  }

  async hasStandaloneLokeeTab(): Promise<boolean> {
    return this.page.locator('[data-testid="view-lokee-weave-btn"]').isVisible();
  }

  async selectSavedTargetByName(name: string): Promise<void> {
    const select = this.page.locator('[data-testid="target-saved-select"]');
    await select.waitFor({ state: 'visible', timeout: 15_000 });
    const option = select.locator('option', { hasText: name });
    await option.waitFor({ state: 'attached', timeout: 15_000 });
    const value = await option.getAttribute('value');
    if (!value) throw new Error(`No saved target option matching ${name}`);
    await select.selectOption(value);
  }

  /** Single owner of the object-node selector, shared by every accessor below. */
  private objectNode(name: string) {
    return this.page.locator('[data-testid^="rf-object-"]').filter({ hasText: name }).first();
  }

  async clickObjectNamed(name: string): Promise<void> {
    const node = this.objectNode(name);
    await node.waitFor({ state: 'visible', timeout: 15_000 });
    try {
      await node.click({ timeout: 5_000 });
    } catch {
      // React Flow clips its pane, so a node in a far-right column can sit
      // outside the viewport. Fit the graph and click again for real — a
      // dispatched synthetic click would bypass the actionability check, which
      // is the one thing this test exists to prove a user can do.
      await this.page.locator('.react-flow__controls-fitview').click({ timeout: 5_000 });
      await node.click({ timeout: 5_000 });
    }
    await this.waitForInspectorLoaded();
  }

  /**
   * The inspector shell renders immediately and fills in after an async fetch,
   * so callers must not read it until the payload is in. `data-state` is set by
   * the component; matching on it beats string-matching the loading copy.
   */
  async waitForInspectorLoaded(timeoutMs = 20_000): Promise<void> {
    await this.page.waitForSelector('[data-testid="lokee-object-inspector"][data-state="ready"]', {
      timeout: timeoutMs,
    });
  }

  async objectNamedVisible(name: string, timeoutMs = 5_000): Promise<boolean> {
    return this.objectNode(name)
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  /** Sections render only once loaded, so callers must await the inspector first. */
  async inspectorHasSection(section: 'growth' | 'source' | 'history'): Promise<boolean> {
    return this.page.locator(`[data-testid="lokee-inspector-${section}"]`).isVisible();
  }

  /**
   * Columns / indexes / keys / triggers are `SchemaBlueprint` now — the same
   * component Compare Schema renders — so they carry `blueprint-*` ids wherever
   * they appear rather than an inspector-specific one.
   */
  async blueprintHasSection(
    section: 'summary' | 'columns' | 'primary-key' | 'indexes' | 'foreign-keys' | 'triggers'
  ): Promise<boolean> {
    return this.page.locator(`[data-testid="blueprint-${section}"]`).isVisible();
  }

  async inspectorText(): Promise<string> {
    return (await this.page.locator('[data-testid="lokee-object-inspector"]').innerText()) ?? '';
  }

  async summaryText(): Promise<string> {
    return (await this.page.locator('[data-testid="lokee-summary"]').innerText()) ?? '';
  }

  async selectHistoryDatabaseContaining(text: string): Promise<void> {
    const select = this.page.locator('[data-testid="lokee-database-select"]');
    await select.waitFor({ state: 'visible', timeout: 20_000 });
    const option = select.locator('option', { hasText: text });
    await option.waitFor({ state: 'attached', timeout: 20_000 });
    const value = await option.getAttribute('value');
    if (!value) throw new Error(`No history database option matching ${text}`);
    await select.selectOption(value);
  }

  async versionCount(): Promise<number> {
    const text = await this.summaryText();
    const match = text.match(/(\d+)\s+versions?\b/i);
    return match ? Number(match[1]) : 0;
  }

  async typeFilterVisible(type: string): Promise<boolean> {
    return this.page.locator(`[data-testid="lokee-rf-type-${type}"]`).isVisible();
  }

  async enableType(type: string): Promise<void> {
    const box = this.page.locator(`[data-testid="lokee-rf-type-${type}"]`);
    await box.waitFor({ state: 'visible', timeout: 10_000 });
    if (!(await box.isChecked())) await box.check();
  }

  // ── Compare versions → revert ────────────────────────────────────────────

  /** Pick the Original side by its visible label (e.g. "Version 1"). */
  async selectOriginalVersion(label: string): Promise<void> {
    await this.selectVersionOption('lokee-original-version', label);
  }

  /** Pick Target by label. Use `selectTargetCurrent()` for the latest snapshot. */
  async selectTargetVersion(label: string): Promise<void> {
    await this.selectVersionOption('lokee-target-version', label);
  }

  async selectTargetCurrent(): Promise<void> {
    const select = this.page.locator('[data-testid="lokee-target-version"]');
    await select.waitFor({ state: 'visible', timeout: 20_000 });
    await select.selectOption('');
  }

  private async selectVersionOption(testId: string, label: string): Promise<void> {
    const select = this.page.locator(`[data-testid="${testId}"]`);
    await select.waitFor({ state: 'visible', timeout: 20_000 });
    const option = select.locator('option', { hasText: label });
    await option.waitFor({ state: 'attached', timeout: 20_000 });
    const value = await option.getAttribute('value');
    if (value == null) throw new Error(`No ${testId} option matching ${label}`);
    await select.selectOption(value);
  }

  async originalVersionLabels(): Promise<string[]> {
    const select = this.page.locator('[data-testid="lokee-original-version"]');
    await select.waitFor({ state: 'visible', timeout: 20_000 });
    return select.locator('option').allTextContents();
  }

  async graphVersionNodeCount(): Promise<number> {
    return this.page.locator('[data-testid^="rf-version-"]').count();
  }

  async compareVersionsButtonVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="lokee-compare-versions-btn"]').isVisible();
  }

  async openCompareModal(): Promise<void> {
    await clickWhen(this.page, '[data-testid="lokee-compare-versions-btn"]');
    await this.page.waitForSelector('[data-testid="lokee-version-compare"][data-state="ready"]', {
      timeout: 30_000,
    });
  }

  async compareTab(tab: 'DIFF' | 'DDL_DIFF' | 'SQL'): Promise<void> {
    await clickWhen(this.page, `[data-testid="lokee-cmp-tab-${tab}"]`);
  }

  async migrationSqlText(): Promise<string> {
    await this.compareTab('SQL');
    const pane = this.page.locator('[data-testid="lokee-cmp-ddl"]');
    await pane.waitFor({ state: 'visible', timeout: 20_000 });
    return pane.innerText();
  }

  /**
   * Apply the revert. A lossy plan parks the button on "Review data loss…",
   * which navigates to Migration SQL rather than running — acknowledge there,
   * then press it again. A safe plan runs on the first press.
   */
  async executeRevert(): Promise<void> {
    const run = this.page.locator('[data-testid="lokee-cmp-run-revert"]');
    await run.waitFor({ state: 'visible', timeout: 20_000 });
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="lokee-cmp-run-revert"]');
        return el instanceof HTMLButtonElement && !el.disabled;
      },
      { timeout: 30_000 }
    );
    if ((await run.innerText()).includes('Review data loss')) {
      await run.click();
      const ack = this.page.locator('[data-testid="lokee-cmp-confirm-lossy"]');
      await ack.waitFor({ state: 'visible', timeout: 10_000 });
      await ack.check();
    }
    await run.click();
  }

  /** Visible toast text, so a failed revert reports the driver's reason. */
  async toastText(): Promise<string> {
    const toasts = this.page.locator('[data-testid="app-toast"]');
    const count = await toasts.count();
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      parts.push((await toasts.nth(i).innerText().catch(() => '')) ?? '');
    }
    return parts.join(' | ');
  }

  async compareModalOpen(): Promise<boolean> {
    return this.page.locator('[data-testid="lokee-version-compare"]').isVisible();
  }

  async closeCompareModal(): Promise<void> {
    if (!(await this.compareModalOpen())) return;
    await clickWhen(this.page, '[data-testid="lokee-version-compare-close"]');
    await this.page.waitForSelector('[data-testid="lokee-version-compare"]', {
      state: 'detached',
      timeout: 15_000,
    });
  }

  async compareSummaryText(): Promise<string> {
    const el = this.page.locator('[data-testid="lokee-cmp-summary"]');
    await el.waitFor({ state: 'visible', timeout: 20_000 });
    return (await el.innerText()) ?? '';
  }

  async compareIdenticalVisible(): Promise<boolean> {
    return this.page.locator('[data-testid="lokee-cmp-identical"]').isVisible();
  }

  async runRevertButtonText(): Promise<string> {
    const run = this.page.locator('[data-testid="lokee-cmp-run-revert"]');
    await run.waitFor({ state: 'visible', timeout: 20_000 });
    return (await run.innerText()) ?? '';
  }

  async runRevertDisabled(): Promise<boolean> {
    const run = this.page.locator('[data-testid="lokee-cmp-run-revert"]');
    await run.waitFor({ state: 'visible', timeout: 20_000 });
    return run.isDisabled();
  }

  /** Tick/untick a changed object in the shared SchemaDiffTree. */
  async toggleCompareObject(tableName: string): Promise<void> {
    const row = this.page.locator(`[data-testid="diff-item"][data-object="${tableName}"]`);
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    const box = row.locator('input[type="checkbox"]');
    await box.waitFor({ state: 'visible', timeout: 10_000 });
    await box.click();
  }

  async compareObjectNames(): Promise<string[]> {
    const items = this.page.locator('[data-testid="diff-item"]');
    await items.first().waitFor({ state: 'visible', timeout: 20_000 });
    const count = await items.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      names.push((await items.nth(i).getAttribute('data-object')) ?? '');
    }
    return names.filter(Boolean);
  }

  async captureFromHistoryBar(): Promise<void> {
    const btn = this.page.locator('[data-testid="lokee-capture-btn"]');
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="lokee-capture-btn"]');
        return el instanceof HTMLButtonElement && !el.disabled;
      },
      { timeout: 15_000 }
    );
    await btn.click();
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="lokee-capture-btn"]');
        return (
          el instanceof HTMLButtonElement &&
          !el.disabled &&
          /(Capture|Capturing)/i.test(el.textContent ?? '')
        );
      },
      { timeout: 30_000 }
    );
  }

  /** "↩ reverted to vN" labels on the version nodes, newest first. */
  async revertedToLabels(): Promise<string[]> {
    const marks = this.page.locator('[data-testid^="rf-version-revert-"]');
    const count = await marks.count();
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push((await marks.nth(i).innerText().catch(() => '')) ?? '');
    }
    return out;
  }
}
