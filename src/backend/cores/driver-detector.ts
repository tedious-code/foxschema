import { createRequire } from 'node:module';
import type { DriverInfo } from '../interfaces/schema-provider.interface';
import { setupDb2ClientEnv } from '../providers/db2/db2.env';

const nodeRequire = createRequire(import.meta.url);

export type { DriverInfo };

export type DatabaseProvider =
  | 'db2'
  | 'postgres'
  | 'mysql'
  | 'oracle'
  | 'sqlserver'
  | 'sqlite';

export type AppDialect = 'postgres' | 'mysql' | 'db2';

const DRIVER_MAP: Record<DatabaseProvider, string> = {
  db2: 'ibm_db',
  postgres: 'pg',
  mysql: 'mysql2',
  oracle: 'oracledb',
  sqlserver: 'mssql',
  sqlite: 'sqlite3',
};

const DIALECT_TO_PROVIDER: Record<AppDialect, DatabaseProvider> = {
  postgres: 'postgres',
  mysql: 'mysql',
  db2: 'db2',
};

export class DriverDetector {
  static resolveProvider(dialect: string): DatabaseProvider {
    const provider = DIALECT_TO_PROVIDER[dialect.toLowerCase() as AppDialect];
    if (!provider) {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }
    return provider;
  }

  static getPackageName(dialect: string): string {
    return DRIVER_MAP[this.resolveProvider(dialect)];
  }

  /**
   * Check whether the npm package for a dialect is installed and loadable.
   */
  static checkProvider(provider: DatabaseProvider): DriverInfo & { provider: DatabaseProvider } {
    const packageName = DRIVER_MAP[provider];

    try {
      const mod = nodeRequire(packageName);

      return {
        provider,
        packageName,
        installed: true,
        version: mod?.version ?? mod?.default?.version,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        provider,
        packageName,
        installed: false,
        installCommand: `npm install ${packageName}`,
        error: message,
      };
    }
  }

  static checkDialect(dialect: string): DriverInfo {
    return this.checkProvider(this.resolveProvider(dialect));
  }

  /**
   * Verify driver package exists before opening a database connection.
   */
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
    const providers = Object.keys(DRIVER_MAP) as DatabaseProvider[];
    return providers.map((provider) => this.checkProvider(provider));
  }

  static detectInstalled(): DriverInfo[] {
    return this.detectAll().filter((driver) => driver.installed);
  }

  static detectMissing(): DriverInfo[] {
    return this.detectAll().filter((driver) => !driver.installed);
  }

  static printDiagnostics(): void {
    const results = this.detectAll();

    console.table(
      results.map((r) => ({
        Provider: r.provider,
        Package: r.packageName,
        Installed: r.installed,
        Version: r.version ?? '-',
        Install: r.installCommand ?? '-',
      }))
    );
  }

  /**
   * Dynamically load a driver module (Node.js only).
   */
  static loadDriver(dialect: string): unknown {
    const provider = this.resolveProvider(dialect);
    this.ensureDriver(dialect);

    if (provider === 'db2') {
      setupDb2ClientEnv();
    }

    const packageName = DRIVER_MAP[provider];
    const mod = nodeRequire(packageName);
    return mod.default ?? mod;
  }
}
