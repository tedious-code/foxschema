import { Builder, WebDriver, By, until, WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/** Build a Chrome WebDriver. Set HEADLESS=false to watch the browser. */
export async function buildDriver(): Promise<WebDriver> {
  const opts = new chrome.Options();
  if (process.env.HEADLESS !== 'false') {
    opts.addArguments('--headless=new', '--disable-gpu');
  }
  opts.addArguments('--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900');

  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(opts)
    .build();
}

/** Wait for an element to be visible and return it. */
export async function waitFor(driver: WebDriver, locator: ReturnType<typeof By.css>, timeoutMs = 10_000): Promise<WebElement> {
  return driver.wait(until.elementLocated(locator), timeoutMs);
}

/** Wait for an element to be visible then click it. */
export async function clickWhen(driver: WebDriver, locator: ReturnType<typeof By.css>): Promise<void> {
  const el = await waitFor(driver, locator);
  await driver.wait(until.elementIsVisible(el), 5_000);
  await el.click();
}

/** Type into an input after clearing it. */
export async function fillInput(driver: WebDriver, locator: ReturnType<typeof By.css>, value: string): Promise<void> {
  const el = await waitFor(driver, locator);
  await el.clear();
  await el.sendKeys(value);
}
