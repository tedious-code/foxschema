import type { Page } from 'playwright';
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'screenshots');
/** Stable copies for docs / SEO / cloud-agent artifacts (no timestamp). */
const ARTIFACT_DIR = process.env.E2E_ARTIFACT_SCREENSHOT_DIR
  ? process.env.E2E_ARTIFACT_SCREENSHOT_DIR
  : '/opt/cursor/artifacts/screenshots';

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Save a PNG screenshot. Returns the timestamped file path under apps/e2e/screenshots. */
export async function saveScreenshot(page: Page, name: string): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const safe = safeName(name);
  const file = join(SCREENSHOT_DIR, `${safe}_${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: false });
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const stable = join(ARTIFACT_DIR, `${safe}.png`);
    copyFileSync(file, stable);
  } catch {
    /* artifact dir may be unavailable outside cloud agents */
  }
  return file;
}

/** Full-page screenshot for marketing / SEO (stable artifact name). */
export async function saveSeoScreenshot(page: Page, name: string): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const safe = safeName(name);
  const file = join(SCREENSHOT_DIR, `${safe}_seo_${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    copyFileSync(file, join(ARTIFACT_DIR, `${safe}.png`));
  } catch {
    /* ignore */
  }
  return file;
}
