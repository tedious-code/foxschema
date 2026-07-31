import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Version of the installed `foxschema` CLI package (npm publish / monorepo).
 * Used so the UI update check compares against the real running build.
 */
export function readCliPackageVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.replace(/^v/i, '').trim();
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../package.json'), // apps/cli/package.json (src or dist/runtime)
    join(here, '../package.json'), // npm-pack layout: dist/ next to package.json
    join(process.cwd(), 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const v = (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version;
      if (v) return v.replace(/^v/i, '').trim();
    } catch {
      /* try next */
    }
  }
  return '0.0.0';
}
