import { createRequire } from 'node:module';
import type { DriverInfo } from '../interfaces';
import { getAdapter, ADAPTERS } from '../providers/adapter-registry';
import { setupDb2ClientEnv } from '../providers/db2/db2.env';

const nodeRequire = createRequire(import.meta.url);

export type { DriverInfo };

/**
 * Driver availability checks. Package names come from the per-provider adapters,
 * so a new platform registers its driver there — not here.
 */
export class DriverDetector {
  static getPackageName(dialect: string): string {
    return getAdapter(dialect).packageName;
  }

  static checkDialect(dialect: string): DriverInfo {
    return this.checkPackage(dialect, getAdapter(dialect).packageName);
  }

  private static checkPackage(dialect: string, packageName: string): DriverInfo {
    // ibm_db's native bindings need the bundled clidriver on PATH/LD_LIBRARY_PATH
    // (especially on Windows) — same setup the DB2 adapter runs before open().
    if (packageName === 'ibm_db') setupDb2ClientEnv();

    try {
      const mod = nodeRequire(packageName);
      return {
        provider: dialect,
        packageName,
        installed: true,
        version: mod?.version ?? mod?.default?.version,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // ibm_db needs its postinstall (clidriver download + native build). Plain
      // `npm install` with --ignore-scripts leaves a broken package that still
      // "resolves" as a module path but fails on require — tell the user how to
      // rebuild correctly.
      const installCommand =
        packageName === 'ibm_db'
          ? 'npm install ibm_db@4.0.1 --foreground-scripts -w @foxschema/web'
          : `npm install ${packageName}`;
      return {
        provider: dialect,
        packageName,
        installed: false,
        installCommand,
        error: message,
      };
    }
  }

  /** Verify the driver package exists before opening a connection. */
  static ensureDriver(dialect: string): DriverInfo {
    const info = this.checkDialect(dialect);
    if (!info.installed) {
      throw new Error(
        `Database driver "${info.packageName}" is not installed for ${dialect}. ` +
          `Install it with: ${info.installCommand}` +
          (info.error ? ` — ${info.error}` : '')
      );
    }
    return info;
  }

  static detectAll(): DriverInfo[] {
    return Object.keys(ADAPTERS).map((dialect) => this.checkDialect(dialect));
  }
}
