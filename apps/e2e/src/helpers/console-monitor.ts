import type { Page, ConsoleMessage } from 'playwright';

export interface ConsoleError {
  level: string;
  message: string;
  timestamp: number;
}

const IGNORED_PATTERNS = [
  /favicon\.ico/,
  /\[HMR\]/,
  /vite:/,
  /\[vite\]/,
];

/**
 * Attach a console listener to the page. Call this immediately after buildDriver(),
 * before any page.goto(), so errors emitted during navigation are captured.
 *
 * Returns a getErrors() function — call it in tests to read accumulated errors.
 * Unlike the old Selenium log API, errors accumulate across the whole session
 * (not cleared between calls), which is fine since all tests check totals.
 */
export function attachConsoleMonitor(page: Page): { getErrors(): ConsoleError[] } {
  const errors: ConsoleError[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const message = msg.text();
    if (IGNORED_PATTERNS.some((p) => p.test(message))) return;
    errors.push({
      level: type === 'error' ? 'SEVERE' : 'WARNING',
      message,
      timestamp: Date.now(),
    });
  });

  return { getErrors: () => [...errors] };
}
