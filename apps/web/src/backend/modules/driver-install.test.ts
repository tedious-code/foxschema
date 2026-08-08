/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  resolveDriverInstallTarget,
  driverInstallHints,
} from './driver-install';

describe('resolveDriverInstallTarget', () => {
  it('detects monorepo workspace from api routes path', () => {
    const fakeRoutes = join(
      process.cwd(),
      'apps/web/src/backend/api/routes.ts'
    );
    const target = resolveDriverInstallTarget(pathToFileURL(fakeRoutes).href);
    expect(target.mode).toBe('workspace');
    expect(target.cwd).toBe(process.cwd());
    expect(target.npmArgs('ibm_db@4.0.1')).toEqual([
      'install',
      'ibm_db@4.0.1',
      '--foreground-scripts',
      '-w',
      '@foxschema/db',
    ]);
  });

  it('uses @foxschema/web workspace for non-db2 drivers', () => {
    const fakeRoutes = join(
      process.cwd(),
      'apps/web/src/backend/api/routes.ts'
    );
    const target = resolveDriverInstallTarget(
      pathToFileURL(fakeRoutes).href,
      'oracledb'
    );
    expect(target.mode).toBe('workspace');
    expect(target.npmArgs('oracledb')).toEqual([
      'install',
      'oracledb',
      '--foreground-scripts',
      '-w',
      '@foxschema/web',
    ]);
  });

  it('uses --prefix when resolving from a bundled dist/ui-server.js layout', () => {
    // Simulate …/some-prefix/foxschema/dist/ui-server.js by pointing at our
    // apps/cli package (name @foxschema/cli) which is accepted as prefix root.
    const fakeBundle = join(process.cwd(), 'apps/cli/dist/ui-server.js');
    const target = resolveDriverInstallTarget(pathToFileURL(fakeBundle).href);
    // From apps/cli/dist → .. = apps/cli (@foxschema/cli) → prefix mode
    // OR if walk finds monorepo first from modules path — dist/../.. = apps
    // which is NOT monorepo. dist/../ = apps/cli → prefix.
    expect(target.mode).toBe('prefix');
    expect(target.npmArgs('ibm_db@4.0.1')).toContain('--prefix');
    expect(target.manualCommand('ibm_db@4.0.1')).toMatch(/--foreground-scripts/);
  });
});

describe('driverInstallHints', () => {
  it('mentions CLI + Docker for ibm_db', () => {
    const hints = driverInstallHints('ibm_db');
    expect(hints).toMatch(/foxschema drivers install db2/);
    expect(hints).toMatch(/docker/i);
  });
});
