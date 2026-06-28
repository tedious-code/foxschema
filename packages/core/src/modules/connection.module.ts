import { DriverDetector } from '../cores/driver-detector';
import { getRegisteredProvider } from '../providers/provider-registry';
import { ConnectionOptions, SchemaProvider } from '../interfaces';

export class ConnectionModule {
  checkDriver(dialect: string) {
    return DriverDetector.checkDialect(dialect);
  }

  async testConnection(dialect: string, option: ConnectionOptions): Promise<boolean> {
    DriverDetector.ensureDriver(dialect);
    return this.getProvider(dialect).testConnection(option);
  }

  getProvider(dialect: string): SchemaProvider {
    DriverDetector.ensureDriver(dialect);
    return getRegisteredProvider(dialect);
  }
}
