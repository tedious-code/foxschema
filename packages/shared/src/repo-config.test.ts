/**
 * Fox Schema (@foxschema/shared)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The repo's own wiring, checked — because both bugs it covers were silent.
 *
 * Adding Turborepo, I gave each package `lint: eslint src` and pointed the root
 * `lint` script at `turbo lint`. That looked like a speedup and was a trap:
 * `eslint .` covers 904 files, the per-package sum covered 801. `npm run lint`
 * passed while CI — which runs `eslint .` in three workflows — still failed, on
 * apps/e2e, apps/cli's scripts and the root scripts. A local gate that checks
 * less than CI is worse than no local gate, because it is trusted.
 *
 * In the same change I listed `tsconfig.base.json` in `globalDependencies`. No
 * such file exists. Turbo hashes nothing for a missing entry, so the cache key
 * silently *narrowed* while the config claimed it had widened — the failure
 * mode being a stale cache hit, which is the one thing a build cache must never
 * do.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

describe('the local lint gate matches the one CI runs', () => {
  const workflows = path.join(repoRoot, '.github', 'workflows');

  /** The lint command every CI workflow invokes. */
  function ciLintCommands(): string[] {
    const found = new Set<string>();
    for (const file of fs.readdirSync(workflows)) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const body = fs.readFileSync(path.join(workflows, file), 'utf8');
      // Line by line with a trimmed prefix rather than one multiline regex.
      // The regex version had `\s*(?:-\s*)?` at the start, which nests
      // quantifiers over the same character class — `security/detect-unsafe-regex`
      // flagged it, and it was right: that is the backtracking shape, and the
      // input here is a file on disk. This has no quantifier ambiguity at all.
      for (const raw of body.split('\n')) {
        const line = raw.trim().replace(/^-\s*/, '');
        if (!line.startsWith('run:')) continue;
        const command = line.slice('run:'.length).trim();
        if (/eslint/.test(command) && /^np[mx]\b/.test(command)) found.add(command);
      }
    }
    return [...found];
  }

  it('finds CI actually linting, so the check below is not vacuous', () => {
    expect(ciLintCommands().length).toBeGreaterThan(0);
  });

  it('runs the same command locally as in CI', () => {
    // Not "a lint command" — the same one. Any narrower local script lets a
    // change pass review and fail on push.
    const root = read('package.json');
    expect(root.scripts.lint).toBe('eslint .');
    for (const cmd of ciLintCommands()) {
      expect(cmd, 'CI lint command').toMatch(/eslint \.$/);
    }
  });

  it('leaves no package-level lint script to shadow it', () => {
    // `turbo lint` runs every `lint` it finds. A per-package one covering only
    // src/ is how the 103-file gap appeared.
    for (const dir of ['packages', 'apps']) {
      for (const pkg of fs.readdirSync(path.join(repoRoot, dir))) {
        const manifest = path.join(repoRoot, dir, pkg, 'package.json');
        if (!fs.existsSync(manifest)) continue;
        const scripts = JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts ?? {};
        expect(scripts.lint, `${dir}/${pkg}`).toBeUndefined();
      }
    }
  });
});

describe('turbo.json refers only to files that exist', () => {
  const turbo = read('turbo.json');

  it('declares global dependencies at all', () => {
    expect(turbo.globalDependencies?.length).toBeGreaterThan(0);
  });

  it('names a real file for each', () => {
    // A missing entry hashes to nothing: the config reads as though the cache
    // key covers that file when it does not.
    const missing = (turbo.globalDependencies as string[]).filter(
      (f) => !fs.existsSync(path.join(repoRoot, f))
    );
    expect(missing).toEqual([]);
  });

  it('keeps the build graph ordered so a dependent never reads stale output', () => {
    // db's build resolves @foxschema/sql's *built* types. Without this edge it
    // followed the workspace symlink into sql's source and emitted 334 files
    // next to it.
    expect(turbo.tasks.build.dependsOn).toContain('^build');
    expect(turbo.tasks.build.outputs).toContain('dist/**');
  });
});

describe('the package manager is pinned', () => {
  it('names one, which Turbo requires and npm honours', () => {
    expect(read('package.json').packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
  });

  it('keeps exactly one lockfile, so the pin means something', () => {
    const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter((f) =>
      fs.existsSync(path.join(repoRoot, f))
    );
    expect(locks).toEqual(['package-lock.json']);
  });
});
