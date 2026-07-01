/**
 * Console error catcher — navigates through the app's main UI flows
 * and asserts there are zero SEVERE browser console errors.
 *
 * No live database required. Requires the dev server running.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { attachConsoleMonitor } from '../helpers/console-monitor.js';
import { saveScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';

let driver: Page;
let app: AppPage;
let getErrors: ReturnType<typeof attachConsoleMonitor>['getErrors'];

beforeAll(async () => {
  driver = await buildDriver();
  // Attach before first navigation so boot errors are captured.
  ({ getErrors } = attachConsoleMonitor(driver));
  app = new AppPage(driver);
});

afterAll(async () => {
  await quitDriver(driver);
});

describe('UI smoke + console error checks', () => {
  it('app boots and toolbar is visible', async () => {
    await app.open();
    expect(await driver.locator('[data-testid="toolbar"]').isVisible()).toBe(true);
  });

  it('no SEVERE console errors on boot', async () => {
    const severe = getErrors().filter((e) => e.level === 'SEVERE');
    if (severe.length > 0) await saveScreenshot(driver, 'auto_boot_severe_error');
    expect(severe, severe.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  it('source config button opens modal', async () => {
    await app.openSourceModal();
    expect(await driver.locator('[data-testid="conn-modal"]').isVisible()).toBe(true);
  });

  it('dialect selector has options', async () => {
    const options = await driver.locator('[data-testid="conn-dialect-select"] option').all();
    expect(options.length).toBeGreaterThan(5);
  });

  it('no SEVERE console errors after opening modal', async () => {
    const severe = getErrors().filter((e) => e.level === 'SEVERE');
    if (severe.length > 0) await saveScreenshot(driver, 'auto_modal_severe_error');
    expect(severe, severe.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  it('modal closes on cancel', async () => {
    await driver.locator('[data-testid="conn-modal"] button[title=""], [data-testid="conn-modal"] button.p-1').first().click();
    await driver.waitForSelector('[data-testid="conn-modal"]', { state: 'detached', timeout: 5_000 });
    expect(await driver.locator('[data-testid="conn-modal"]').count()).toBe(0);
  });

  it('target config button opens modal', async () => {
    await app.openTargetModal();
    expect(await driver.locator('[data-testid="conn-modal"]').isVisible()).toBe(true);
    // Close it
    await driver.locator('[data-testid="conn-modal"] button.p-1').first().click();
    await driver.waitForSelector('[data-testid="conn-modal"]', { state: 'detached', timeout: 5_000 });
  });

  it('no SEVERE console errors at end of smoke run', async () => {
    const severe = getErrors().filter((e) => e.level === 'SEVERE');
    if (severe.length > 0) await saveScreenshot(driver, 'auto_end_severe_error');
    expect(severe, severe.map((e) => e.message).join('\n')).toHaveLength(0);
  });
});
