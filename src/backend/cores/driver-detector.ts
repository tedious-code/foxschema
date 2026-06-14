import { createRequire } from 'node:module';
import type { DriverInfo } from '../interfaces/schema-provider.interface';
import { getAdapter, ADAPTERS } from '../providers/adapter-registry';

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
      return {
        provider: dialect,
        packageName,
        installed: false,
        installCommand: `npm install ${packageName}`,
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
