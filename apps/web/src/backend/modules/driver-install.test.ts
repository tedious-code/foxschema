import { describe, expect, it } from 'vitest';
import {
  DRIVER_NPM_INSTALL_ENV,
  driverInstallHints,
  ibmDbPackageDir,
  isCacheKeyForPackage,
  purgePackageRequireCache,
} from './driver-install';

describe('driverInstallHints — advice must match the driver', () => {
  it('gives Db2 advice for ibm_db', () => {
    const hints = driverInstallHints('ibm_db');
    expect(hints).toMatch(/db2/i);
    expect(hints).toMatch(/docker/i);
  });

  it('does not tell an oracledb user to install Db2', () => {
    // The hint list used to be emitted for every driver, so an oracledb
    // failure advised installing db2 and pulling the Db2 Docker image.
    const hints = driverInstallHints('oracledb');
    expect(hints).not.toMatch(/db2/i);
    expect(hints).toContain('oracledb');
  });

  it('names the package it is actually talking about', () => {
    expect(driverInstallHints('better-sqlite3')).toContain('better-sqlite3');
  });
});

describe('DRIVER_NPM_INSTALL_ENV', () => {
  it('forces npm 11 allow-scripts on so ibm_db postinstall can run', () => {
    expect(DRIVER_NPM_INSTALL_ENV.npm_config_ignore_scripts).toBe('false');
    expect(DRIVER_NPM_INSTALL_ENV.npm_config_dangerously_allow_all_scripts).toBe('true');
  });
});

describe('ibmDbPackageDir', () => {
  it('resolves the installed ibm_db package', () => {
    const dir = ibmDbPackageDir();
    expect(dir).toBeTruthy();
    expect(dir).toMatch(/ibm_db$/);
  });
});

describe('isCacheKeyForPackage — match a path segment, not a substring', () => {
  it('matches the package itself', () => {
    expect(isCacheKeyForPackage('/repo/node_modules/pg/lib/index.js', 'pg')).toBe(true);
  });

  it('does not match packages whose name merely starts the same', () => {
    // Purging `pg` by substring also evicted pg-pool and pg-protocol,
    // re-instantiating module state unrelated to the install.
    expect(isCacheKeyForPackage('/repo/node_modules/pg-pool/index.js', 'pg')).toBe(false);
    expect(isCacheKeyForPackage('/repo/node_modules/pg-protocol/dist/x.js', 'pg')).toBe(false);
  });

  it('does not match a path that merely contains the name', () => {
    expect(isCacheKeyForPackage('/home/pg/project/node_modules/mssql/x.js', 'pg')).toBe(false);
  });

  it('matches a nested copy', () => {
    expect(
      isCacheKeyForPackage('/repo/node_modules/foo/node_modules/pg/lib/x.js', 'pg')
    ).toBe(true);
  });

  it('handles Windows separators', () => {
    expect(isCacheKeyForPackage('C:\\repo\\node_modules\\ibm_db\\lib\\odbc.js', 'ibm_db')).toBe(
      true
    );
    expect(isCacheKeyForPackage('C:\\repo\\node_modules\\ibm_db_other\\x.js', 'ibm_db')).toBe(
      false
    );
  });

  it('does not throw for a package that is not installed', () => {
    expect(() => purgePackageRequireCache('definitely-not-installed-xyz')).not.toThrow();
  });
});
