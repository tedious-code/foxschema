import { WebDriver } from 'selenium-webdriver';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'screenshots');

/** Save a PNG screenshot. Returns the file path. */
export async function saveScreenshot(driver: WebDriver, name: string): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const data = await driver.takeScreenshot();
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = join(SCREENSHOT_DIR, `${safe}_${Date.now()}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}
