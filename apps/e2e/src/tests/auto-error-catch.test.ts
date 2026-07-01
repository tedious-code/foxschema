/**
 * Console error catcher — navigates through the app's main UI flows
 * and asserts there are zero SEVERE browser console errors.
 *
 * No live database required. Requires the dev server running.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { WebDriver, By } from 'selenium-webdriver';
import { buildDriver, waitFor, clickWhen } from '../helpers/driver.js';
import { getBrowserErrors } from '../helpers/console-monitor.js';
import { saveScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';

let driver: WebDriver;
let app: AppPage;

beforeAll(async () => {
  driver = await buildDriver();
  app = new AppPage(driver);
});

afterAll(async () => {
  await driver?.quit();
});

describe('UI smoke + console error checks', () => {
  it('app boots and toolbar is visible', async () => {
    await app.open();
    const toolbar = await waitFor(driver, By.css('[data-testid="toolbar"]'));
    expect(await toolbar.isDisplayed()).toBe(true);
  });

  it('no SEVERE console errors on boot', async () => {
    const errors = await getBrowserErrors(driver);
    const severe = errors.filter((e) => e.level === 'SEVERE');
    if (severe.length > 0) {
      await saveScreenshot(driver, 'auto_boot_severe_error');
    }
    expect(severe, severe.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  it('source config button opens modal', async () => {
    await app.openSourceModal();
    const modal = await waitFor(driver, By.css('[data-testid="conn-modal"]'));
    expect(await modal.isDisplayed()).toBe(true);
  });

  it('dialect selector has options', async () => {
    const sel = await waitFor(driver, By.css('[data-testid="conn-dialect-select"]'));
    const options = await sel.findElements(By.css('option'));
    expect(options.length).toBeGreaterThan(5);
  });

  it('no SEVERE console errors after opening modal', async () => {
    const errors = await getBrowserErrors(driver);
    const severe = errors.filter((e) => e.level === 'SEVERE');
    if (severe.length > 0) {
      await saveScreenshot(driver, 'auto_modal_severe_error');
    }
    expect(severe, severe.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  it('modal closes on cancel', async () => {
    // Press Escape to close — the modal has a close button but ESC is simpler
    await driver.findElement(By.css('[data-testid="conn-modal"]'));
    // Click close button (X)
    const closeBtn = await driver.findElement(
      By.css('[data-testid="conn-modal"] button[title=""], [data-testid="conn-modal"] button.p-1')
    );
    await closeBtn.click();
    // Modal should disappear
    await driver.wait(async () => {
      const modals = await driver.findElements(By.css('[data-testid="conn-modal"]'));
      return modals.length === 0;
    }, 5_000);
    const modals = await driver.findElements(By.css('[data-testid="conn-modal"]'));
    expect(modals).toHaveLength(0);
  });

  it('target config button opens modal', async () => {
    await app.openTargetModal();
    const modal = await waitFor(driver, By.css('[data-testid="conn-modal"]'));
    expect(await modal.isDisplayed()).toBe(true);
    // Close it
    const closeBtn = await driver.findElement(
      By.css('[data-testid="conn-modal"] button.p-1')
    );
    await closeBtn.click();
  });

  it('no SEVERE console errors at end of smoke run', async () => {
    const errors = await getBrowserErrors(driver);
    const severe = errors.filter((e) => e.level === 'SEVERE');
    if (severe.length > 0) {
      await saveScreenshot(driver, 'auto_end_severe_error');
    }
    expect(severe, severe.map((e) => e.message).join('\n')).toHaveLength(0);
  });
});
