import type { Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'screenshots');

/** Save a PNG screenshot. Returns the file path. */
export async function saveScreenshot(page: Page, name: string): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = join(SCREENSHOT_DIR, `${safe}_${Date.now()}.png`);
  await page.screenshot({ path: file });
  return file;
}
