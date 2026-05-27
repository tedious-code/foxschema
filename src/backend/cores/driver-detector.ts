export type DatabaseProvider =
  | 'db2'
  | 'postgres'
  | 'mysql'
  | 'oracle'
  | 'sqlserver'
  | 'sqlite';

export interface DriverInfo {
  provider: DatabaseProvider;
  packageName: string;
  installed: boolean;
  version?: string;
  installCommand?: string;
  error?: string;
}



const DRIVER_MAP: Record<DatabaseProvider, string> = {
  db2: 'ibm_db',
  postgres: 'pg',
  mysql: 'mysql2',
  oracle: 'oracledb',
  sqlserver: 'mssql',
  sqlite: 'sqlite3'
};

export class DriverDetector {

  /**
   * Check a single provider driver
   */
  static async checkProvider(
    provider: DatabaseProvider
  ): Promise<DriverInfo> {

    const packageName = DRIVER_MAP[provider];

    try {
      require.resolve(packageName);

      const pkg = require(`${packageName}/package.json`);

      return {
        provider,
        packageName,
        installed: true,
        version: pkg.version
      };

    } catch (error: any) {

      return {
        provider,
        packageName,
        installed: false,
        installCommand: `npm install ${packageName}`,
        error: error.message
      };
    }
  }

  /**
   * Detect all supported database drivers
   */
  static async detectAll(): Promise<DriverInfo[]> {

    const providers = Object.keys(DRIVER_MAP) as DatabaseProvider[];

    return Promise.all(
      providers.map(provider =>
        this.checkProvider(provider)
      )
    );
  }

  /**
   * Detect installed providers only
   */
  static async detectInstalled(): Promise<DriverInfo[]> {

    const all = await this.detectAll();

    return all.filter(driver => driver.installed);
  }

  /**
   * Detect missing providers only
   */
  static async detectMissing(): Promise<DriverInfo[]> {

    const all = await this.detectAll();

    return all.filter(driver => !driver.installed);
  }

  /**
   * Print diagnostics table
   */
  static async printDiagnostics(): Promise<void> {

    const results = await this.detectAll();

    console.table(
      results.map(r => ({
        Provider: r.provider,
        Package: r.packageName,
        Installed: r.installed,
        Version: r.version ?? '-',
        Install: r.installCommand ?? '-'
      }))
    );
  }
    static async loadDriver(provider: DatabaseProvider): Promise<any> {

    const info =
      await this.checkProvider(provider);

    if (!info.installed) {
      throw new Error(
        `Missing driver ${info.packageName}.
        Install:
        ${info.installCommand}`
            );
    }

    return require(info.packageName);
  }
}