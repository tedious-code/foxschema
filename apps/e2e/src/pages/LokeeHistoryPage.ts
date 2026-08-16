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
        return new RegExp(`Total Versions:\\s*${expected}\\b`, 'i').test(text);
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
  async inspectorHasSection(section: 'growth' | 'source' | 'columns' | 'indexes'): Promise<boolean> {
    return this.page.locator(`[data-testid="lokee-inspector-${section}"]`).isVisible();
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
    const match = text.match(/Total Versions:\s*(\d+)/i);
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
}
