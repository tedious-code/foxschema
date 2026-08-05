import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The whole point of @foxschema/sql is that it runs anywhere — browser bundle,
 * worker, edge runtime. That property is invisible at review time: a single
 * `import 'node:fs'` in a file nobody thinks of as Node-only silently breaks
 * every frontend consumer at bundle time, not here.
 *
 * So assert it mechanically instead of trusting the directory layout.
 */

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** Every `from '…'` / `import('…')` specifier in a file. */
function specifiers(src: string): string[] {
  return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

describe('@foxschema/sql stays runtime-neutral', () => {
  const files = sourceFiles(SRC);

  it('covers the whole package', () => {
    // Guards against the walker silently matching nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  it('imports no Node built-ins', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('node:')) {
          offenders.push(`${path.relative(SRC, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports no @foxschema/db (the dependency runs one way only)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
        if (spec === '@foxschema/db' || spec.startsWith('@foxschema/db/')) {
          offenders.push(`${path.relative(SRC, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
