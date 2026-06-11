import { ConnectionOptions } from '../interfaces/schema-provider.interface';
import { PROVIDER_SETTINGS, getProviderSettings } from '../providers/provider-settings';

export const DEFAULT_PORTS: Record<string, number> = Object.fromEntries(
  Object.values(PROVIDER_SETTINGS).map((s) => [s.dialect, s.defaultPort])
);

/** Delegates to the provider's own connection-string format. */
export function buildConnectionString(dialect: string, option: ConnectionOptions): string {
  return getProviderSettings(dialect).buildConnectionString(option);
}

/**
 * Returns options guaranteed to carry a usable connectionString:
 * keeps a user-entered string if present, otherwise builds one.
 */
export function withConnectionString(dialect: string, option: ConnectionOptions): ConnectionOptions {
  if (option.connectionString && option.connectionString.trim().length > 0) {
    return option;
  }
  return { ...option, connectionString: buildConnectionString(dialect, option) };
}
