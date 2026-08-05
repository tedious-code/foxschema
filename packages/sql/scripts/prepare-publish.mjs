#!/usr/bin/env node
/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build a publishable folder for @foxschema/sql.
 *
 * Why a staging folder instead of publishing packages/sql directly: the
 * workspace `exports` has to keep pointing at TypeScript source, because the
 * backend runs under tsx and the CLI's esbuild bundle both resolve this package
 * through `exports` with no alias — repointing it at ./dist would silently make
 * development load stale build output. `publishConfig.exports` would be the
 * tidy answer, but npm 10 does not apply it (verified: it stays as-written in
 * the packed tarball), so the manifest is rewritten here instead.
 *
 * Usage (from repo root):
 *   npm run build -w @foxschema/sql
 *   node packages/sql/scripts/prepare-publish.mjs
 *   npm publish packages/sql/npm-pack
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const outDir = join(pkgRoot, 'npm-pack');
const src = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

if (!existsSync(join(pkgRoot, 'dist', 'index.js'))) {
  throw new Error('Missing packages/sql/dist — run `npm run build -w @foxschema/sql` first');
}
if (!existsSync(join(pkgRoot, 'dist', 'index.d.ts'))) {
  throw new Error('Missing packages/sql/dist/index.d.ts — the build did not emit declarations');
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(pkgRoot, 'dist'), join(outDir, 'dist'), { recursive: true });

for (const [from, to] of [
  [join(pkgRoot, 'README.md'), 'README.md'],
  [join(repoRoot, 'LICENSE'), 'LICENSE'],
]) {
  if (existsSync(from)) cpSync(from, join(outDir, to));
  else console.log(`⚠ missing ${from} — publishing without it`);
}

// Carry metadata across, but replace anything that describes the workspace
// layout. `scripts` is dropped deliberately: a stray prepublishOnly in the
// staging folder would try to rebuild from sources that are not there.
const {
  scripts: _scripts,
  publishConfig: _publishConfig,
  '//': _note,
  ...rest
} = src;

writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify(
    {
      ...rest,
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
      },
      files: ['dist', 'README.md', 'LICENSE'],
      publishConfig: { access: 'public' },
    },
    null,
    2
  ) + '\n'
);

console.log(`✔ ${outDir}`);
console.log(`  npm publish ${outDir.replace(repoRoot + '/', '')}`);
