/**
 * Smoke test: the app loads and the toolbar is present.
 * No DB connection required — safe to run in CI with just the dev server.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { WebDriver } from 'selenium-webdriver';
import { buildDriver, BASE_URL } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';

let driver: WebDriver;

beforeAll(async () => {
  driver = await buildDriver();
});

afterAll(async () => {
  await driver?.quit();
});

describe('App boot', () => {
  it('loads the app at BASE_URL', async () => {
    await driver.get(BASE_URL);
    const title = await driver.getTitle();
    expect(title).toBeTruthy();
  });

  it('renders the top toolbar', async () => {
    const page = new AppPage(driver);
    await page.open();
    const toolbar = await driver.findElement({ css: '[data-testid="toolbar"]' });
    expect(await toolbar.isDisplayed()).toBe(true);
  });
});
