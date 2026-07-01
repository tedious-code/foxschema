/**
 * Smoke test: the app loads and the toolbar is present.
 * No DB connection required — safe to run in CI with just the dev server.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { Page } from 'playwright';
import { buildDriver, quitDriver, BASE_URL } from '../helpers/driver.js';
import { AppPage } from '../pages/AppPage.js';

let driver: Page;

beforeAll(async () => {
  driver = await buildDriver();
});

afterAll(async () => {
  await quitDriver(driver);
});

describe('App boot', () => {
  it('loads the app at BASE_URL', async () => {
    await driver.goto(BASE_URL);
    const title = await driver.title();
    expect(title).toBeTruthy();
  });

  it('renders the top toolbar', async () => {
    const page = new AppPage(driver);
    await page.open();
    expect(await driver.locator('[data-testid="toolbar"]').isVisible()).toBe(true);
  });
});
