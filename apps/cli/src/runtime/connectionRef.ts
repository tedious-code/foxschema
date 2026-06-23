import { password as passwordPrompt } from '@inquirer/prompts';
import { buildConnectionString, type ConnectionOptions } from '@foxschema/shared';
import { getContext } from './store';

export interface ResolvedRef {
  dialect: string;
  option: ConnectionOptions;
  schema: string;
}

/** CLI flags that name a connection: a saved name/id, or inline fields. */
export interface RefFlags {
  connection?: string; // saved connection name or id
  dialect?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  schema?: string;
  url?: string; // full connection string
}

/**
 * Resolve a connection reference to concrete credentials. Order:
 *   1. --connection <name|id>  → decrypt a saved connection
 *   2. --url <conn-string> (+ --dialect)
 *   3. inline --dialect/--host/--database/--user (+ password from env or prompt)
 * Passwords are never taken from a flag (they leak into history/`ps`).
 */
export async function resolveRef(flags: RefFlags): Promise<ResolvedRef> {
  if (flags.connection) {
    const ctx = await getContext();
    const list = await ctx.connections.list(ctx.userId);
    const match = list.find((c) => c.id === flags.connection || c.name === flags.connection);
    if (!match) throw new Error(`Saved connection "${flags.connection}" not found (see \`foxschema connections list\`).`);
    const resolved = await ctx.connections.resolve(ctx.userId, match.id);
    if (!resolved) throw new Error('Could not decrypt the saved connection.');
    return { dialect: resolved.dialect, option: resolved.option, schema: flags.schema ?? resolved.schema ?? '' };
  }

  if (!flags.dialect) {
    throw new Error('Provide --connection <name>, or --dialect with connection details (or --url).');
  }

  const option: ConnectionOptions = {
    connectionString: flags.url,
    host: flags.host,
    port: flags.port ? Number(flags.port) : undefined,
    database: flags.database,
    username: flags.user,
    schema: flags.schema,
    password: process.env.FOXSCHEMA_DB_PASSWORD || undefined,
  };

  if (!option.connectionString && !option.password) {
    option.password = await passwordPrompt({
      message: `Password for ${flags.user ?? 'user'}@${flags.host ?? 'host'}:`,
      mask: true,
    });
  }
  if (!option.connectionString) option.connectionString = buildConnectionString(flags.dialect, option);

  return { dialect: flags.dialect, option, schema: flags.schema ?? '' };
}
