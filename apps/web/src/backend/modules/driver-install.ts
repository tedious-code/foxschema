/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Resolve where/how to `npm install` optional native drivers (ibm_db, …).
 * The API Install button used a fixed monorepo-relative WORKSPACE_ROOT that
 * resolves to `/` when routes are bundled into `ui-server.js` — installs then
 * fail intermittently or write into the wrong tree.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { hasDb2Clidriver } from '@foxschema/db';

const nodeRequire = createRequire(import.meta.url);

export type DriverInstallMode = 'workspace' | 'prefix';

export type DriverInstallTarget = {
  cwd: string;
  mode: DriverInstallMode;
  /** Human-facing npm command for copy/paste. */
  manualCommand: (spec: string) => string;
  /** argv for `npm` (no binary). */
  npmArgs: (spec: string) => string[];
};

function readPkgName(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      private?: boolean;
      workspaces?: unknown;
    };
    return raw.name ?? null;
  } catch {
    return null;
  }
}

function isFoxschemaMonorepo(dir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      workspaces?: string[] | { packages?: string[] };
    };
    if (raw.name !== 'foxschema' && raw.name !== undefined && !raw.workspaces) return false;
    const ws = Array.isArray(raw.workspaces)
      ? raw.workspaces
      : raw.workspaces?.packages ?? [];
    if (!ws.some((p) => p.includes('apps/web') || p.includes('packages/*') || p === 'apps/*')) {
      // Still accept if apps/web/package.json exists next to root
      return existsSync(join(dir, 'apps/web/package.json'));
    }
    return existsSync(join(dir, 'apps/web/package.json'));
  } catch {
    return false;
  }
}

/**
 * Locate install target from the calling module URL (routes.ts or bundled
 * ui-server.js) and optional process.cwd() fallback.
 */
export function resolveDriverInstallTarget(
  fromUrl: string = import.meta.url
): DriverInstallTarget {
  const here = dirname(fileURLToPath(fromUrl));

  // Source: apps/web/src/backend/api → ../../../../.. = monorepo root
  const fromApiSource = resolve(here, '../../../../..');
  if (isFoxschemaMonorepo(fromApiSource)) {
    return workspaceTarget(fromApiSource);
  }

  // Source: apps/web/src/backend/modules → ../../../.. = monorepo root
  const fromModules = resolve(here, '../../../..');
  if (isFoxschemaMonorepo(fromModules)) {
    return workspaceTarget(fromModules);
  }

  // Bundled ui-server: …/foxschema/dist/ui-server.js → package root is …
  const bundledRoot = resolve(here, '..');
  const bundledName = readPkgName(bundledRoot);
  if (bundledName === 'foxschema' || bundledName === '@foxschema/cli') {
    return prefixTarget(bundledRoot);
  }

  if (isFoxschemaMonorepo(process.cwd())) {
    return workspaceTarget(process.cwd());
  }

  // Global npm / Homebrew: install next to the running foxschema package if found
  try {
    const foxPkg = dirname(nodeRequire.resolve('foxschema/package.json'));
    return prefixTarget(foxPkg);
  } catch {
    /* not resolvable */
  }

  return prefixTarget(process.cwd());
}

function workspaceTarget(cwd: string): DriverInstallTarget {
  return {
    cwd,
    mode: 'workspace',
    npmArgs: (spec) => ['install', spec, '--foreground-scripts', '-w', '@foxschema/web'],
    manualCommand: (spec) =>
      `npm install ${spec} --foreground-scripts -w @foxschema/web`,
  };
}

function prefixTarget(cwd: string): DriverInstallTarget {
  return {
    cwd,
    mode: 'prefix',
    npmArgs: (spec) => ['install', spec, '--foreground-scripts', '--prefix', cwd],
    manualCommand: (spec) =>
      `npm install ${spec} --foreground-scripts --prefix "${cwd}"`,
  };
}

export type NpmInstallResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  cwd: string;
  args: string[];
  manualCommand: string;
};

/** Run `npm install <spec> --foreground-scripts` into the resolved target. */
export function npmInstallPackage(
  packageSpec: string,
  fromUrl?: string
): Promise<NpmInstallResult> {
  const target = resolveDriverInstallTarget(fromUrl);
  const args = target.npmArgs(packageSpec);
  return new Promise((resolvePromise) => {
    const proc = spawn('npm', args, {
      cwd: target.cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        // Force scripts even if the user has npm_config_ignore_scripts=true
        npm_config_ignore_scripts: '',
        npm_config_foreground_scripts: 'true',
      },
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err: Error) => {
      resolvePromise({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || err.message,
        cwd: target.cwd,
        args,
        manualCommand: target.manualCommand(packageSpec),
      });
    });
    proc.on('close', (code) => {
      resolvePromise({
        ok: code === 0,
        code,
        stdout,
        stderr,
        cwd: target.cwd,
        args,
        manualCommand: target.manualCommand(packageSpec),
      });
    });
  });
}

/** Drop cached failed/successful requires so a fresh install can load. */
export function purgePackageRequireCache(packageName: string): void {
  try {
    const resolved = nodeRequire.resolve(packageName);
    delete nodeRequire.cache[resolved];
    // Also clear nested paths under the package root
    const root = dirname(resolved);
    for (const key of Object.keys(nodeRequire.cache)) {
      if (key.startsWith(root)) delete nodeRequire.cache[key];
    }
  } catch {
    // Not resolvable yet — clear any partial cache entries by name
    for (const key of Object.keys(nodeRequire.cache)) {
      if (key.includes(`${packageName}`) || key.includes('node_modules/ibm_db')) {
        delete nodeRequire.cache[key];
      }
    }
  }
}

export type VerifyDriverResult = {
  ok: boolean;
  error?: string;
  /** ibm_db package present but clidriver missing (scripts skipped). */
  needsClidriverRebuild?: boolean;
};

/** After npm install, confirm the driver actually loads. */
export function verifyInstalledDriver(packageName: string): VerifyDriverResult {
  purgePackageRequireCache(packageName);
  try {
    nodeRequire(packageName);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      needsClidriverRebuild: packageName === 'ibm_db',
    };
  }
  if (packageName === 'ibm_db' && !hasDb2Clidriver()) {
    return {
      ok: false,
      error:
        'ibm_db is present but the DB2 clidriver was not downloaded (install scripts were skipped). Re-run with --foreground-scripts.',
      needsClidriverRebuild: true,
    };
  }
  return { ok: true };
}

/**
 * Install + verify. For ibm_db, retries once with a forced reinstall when the
 * package landed without clidriver (common when npm_config_ignore_scripts is set).
 */
export async function installAndVerifyDriver(
  packageName: string,
  versionPin?: string
): Promise<NpmInstallResult & VerifyDriverResult> {
  const spec = versionPin ? `${packageName}@${versionPin}` : packageName;
  let result = await npmInstallPackage(spec);
  let verify = verifyInstalledDriver(packageName);

  if (
    result.ok &&
    !verify.ok &&
    packageName === 'ibm_db' &&
    verify.needsClidriverRebuild
  ) {
    // Force a clean scripted install into the same target
    const retrySpec = versionPin ? `ibm_db@${versionPin}` : 'ibm_db@4.0.1';
    const target = resolveDriverInstallTarget();
    const forceArgs =
      target.mode === 'workspace'
        ? ['install', retrySpec, '--foreground-scripts', '--force', '-w', '@foxschema/web']
        : ['install', retrySpec, '--foreground-scripts', '--force', '--prefix', target.cwd];
    result = await new Promise<NpmInstallResult>((resolvePromise) => {
      const proc = spawn('npm', forceArgs, {
        cwd: target.cwd,
        stdio: 'pipe',
        env: {
          ...process.env,
          npm_config_ignore_scripts: '',
          npm_config_foreground_scripts: 'true',
        },
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('close', (code) => {
        resolvePromise({
          ok: code === 0,
          code,
          stdout,
          stderr,
          cwd: target.cwd,
          args: forceArgs,
          manualCommand: target.manualCommand(retrySpec),
        });
      });
      proc.on('error', (err: Error) => {
        resolvePromise({
          ok: false,
          code: null,
          stdout,
          stderr: err.message,
          cwd: target.cwd,
          args: forceArgs,
          manualCommand: target.manualCommand(retrySpec),
        });
      });
    });
    verify = verifyInstalledDriver(packageName);
  }

  return { ...result, ...verify };
}

/** Tips appended to install failures (platform / toolchain). */
export function driverInstallHints(packageName: string): string {
  const lines: string[] = [
    'Also try: foxschema drivers install db2',
    'Or use Docker (Db2 included, linux/amd64): docker pull 5nickels/foxschema:latest',
  ];
  if (packageName === 'ibm_db') {
    if (process.platform === 'darwin') {
      lines.unshift(
        'macOS: ensure Xcode CLT (`xcode-select --install`) and a native Node for your CPU (`node -p process.arch`).'
      );
    } else if (process.platform === 'linux' && process.arch === 'arm64') {
      lines.unshift(
        'linux/arm64: ibm_db has no official build — use Docker linux/amd64 (or an x64 host).'
      );
    } else if (process.platform === 'win32') {
      lines.unshift(
        'Windows: install scripts must run so clidriver downloads; avoid npm config set ignore-scripts true.'
      );
    }
  }
  return lines.join(' ');
}
