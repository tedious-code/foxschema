import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';
import { buildDb2ConnectionString } from './db2.connection';

export const db2Settings: ProviderConnectionSettings = {
  dialect: 'db2',
  label: 'IBM DB2',
  defaultPort: 50000,
  schemaRequired: true,

  // Single source of truth for the DB2 format: ibm_db only accepts the
  // keyword=value; form (never a URL), so this also parses+normalizes any
  // existing connection string the caller passes in.
  buildConnectionString(option: ConnectionOptions): string {
    return buildDb2ConnectionString(option, option.schema);
  },
};
