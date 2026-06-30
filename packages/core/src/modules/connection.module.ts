import { DriverDetector } from '../cores/driver-detector';
import { getRegisteredProvider } from '../providers/provider-registry';
import { ConnectionOptions, SchemaProvider } from '../interfaces';

export class ConnectionModule {
  checkDriver(dialect: string) {
    return DriverDetector.checkDialect(dialect);
  }

  async testConnection(dialect: string, option: ConnectionOptions): Promise<{ success: boolean; version?: string }> {
    DriverDetector.ensureDriver(dialect);
    const provider = this.getProvider(dialect);
    const success = await provider.testConnection(option);
    if (!success) return { success: false };
    const version = await provider.detectVersion?.(option).catch(() => undefined);
    return { success: true, version };
  }

  getProvider(dialect: string): SchemaProvider {
    DriverDetector.ensureDriver(dialect);
    return getRegisteredProvider(dialect);
  }
}
