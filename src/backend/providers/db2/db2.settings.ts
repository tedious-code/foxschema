import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const db2Settings: ProviderConnectionSettings = {
  dialect: 'db2',
  label: 'IBM DB2',
  defaultPort: 50000,

  // ibm_db only accepts the keyword=value; form, never a URL
  buildConnectionString(option: ConnectionOptions): string {
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;

    let str =
      `DATABASE=${option.database || ''};HOSTNAME=${host};PORT=${port};PROTOCOL=TCPIP;` +
      `UID=${option.username || ''};PWD=${option.password || ''};Authentication=SERVER;`;
    if (option.schema) str += `CURRENTSCHEMA=${option.schema.toUpperCase()};`;
    if (option.ssl?.enabled) str += `Security=SSL;`;
    return str;
  },
};
