import { WebDriver, logging } from 'selenium-webdriver';

const IGNORED_PATTERNS = [
  /favicon\.ico/,
  /\[HMR\]/,
  /vite:/,
  /\[vite\]/,
];

export interface ConsoleError {
  level: string;
  message: string;
  timestamp: number;
}

/**
 * Collect browser console errors/warnings.
 * Must call `enableLogging()` in beforeAll before using the driver.
 */
export async function getBrowserErrors(driver: WebDriver): Promise<ConsoleError[]> {
  let entries: logging.Entry[];
  try {
    entries = await driver.manage().logs().get(logging.Type.BROWSER);
  } catch {
    return [];
  }

  return entries
    .filter((e) => ['SEVERE', 'WARNING'].includes(e.level.name))
    .filter((e) => !IGNORED_PATTERNS.some((p) => p.test(e.message)))
    .map((e) => ({ level: e.level.name, message: e.message, timestamp: e.timestamp }));
}

/** Build driver with browser logging enabled (call instead of plain buildDriver when you need console monitoring). */
export function browserLoggingPrefs(): logging.Preferences {
  const prefs = new logging.Preferences();
  prefs.setLevel(logging.Type.BROWSER, logging.Level.WARNING);
  return prefs;
}
