import { input, password as passwordPrompt } from '@inquirer/prompts';
import chalk from 'chalk';
import { buildConnectionString, type ConnectionOptions } from '@foxschema/shared';
import { getContext } from '../runtime/store';

/** `connections list` — saved connections (never shows passwords). */
export async function listConnections(): Promise<void> {
  const ctx = await getContext();
  const rows = await ctx.connections.list(ctx.userId);
  if (rows.length === 0) {
    console.log(chalk.dim('No saved connections. Add one with `foxschema connections add`.'));
    return;
  }
  for (const c of rows) {
    const loc = [c.host, c.database, c.schema].filter(Boolean).join(' / ');
    console.log(`${chalk.bold(c.name || '(unnamed)')}  ${chalk.dim(`[${c.dialect}]`)}  ${loc}`);
    console.log(`  ${chalk.dim(`id ${c.id}  ·  ${c.username ?? ''}`)}`);
  }
}

/** `connections add` — collect fields (password prompted, never a flag) and save encrypted. */
export async function addConnection(opts: {
  name?: string;
  dialect?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  schema?: string;
}): Promise<void> {
  const ctx = await getContext();
  const name = opts.name || (await input({ message: 'Connection name:', validate: (v) => !!v.trim() || 'Required' }));
  const dialect = opts.dialect || (await input({ message: 'Dialect (db2/postgres/mysql):', default: 'db2' }));
  const host = opts.host || (await input({ message: 'Host:' }));
  const port = opts.port || (await input({ message: 'Port (blank for default):', default: '' }));
  const database = opts.database || (await input({ message: 'Database:' }));
  const username = opts.user || (await input({ message: 'Username:' }));
  const schema = opts.schema ?? (await input({ message: 'Schema (blank if none):', default: '' }));
  const password = await passwordPrompt({ message: 'Password:', mask: true });

  const option: ConnectionOptions = {
    host: host || undefined,
    port: port ? Number(port) : undefined,
    database: database || undefined,
    username: username || undefined,
    password: password || undefined,
    schema: schema || undefined,
  };
  option.connectionString = buildConnectionString(dialect, option);

  const saved = await ctx.connections.create(ctx.userId, { name, dialect, schema: schema || undefined, option });
  console.log(chalk.green(`✔ Saved connection "${saved.name}" (${saved.dialect}) · id ${saved.id}`));
  console.log(chalk.dim('The password is encrypted at rest with your keychain key.'));
}

/** `connections remove <name|id>`. */
export async function removeConnection(nameOrId: string): Promise<void> {
  const ctx = await getContext();
  const list = await ctx.connections.list(ctx.userId);
  const match = list.find((c) => c.id === nameOrId || c.name === nameOrId);
  if (!match) {
    console.error(chalk.red(`No saved connection "${nameOrId}".`));
    process.exitCode = 1;
    return;
  }
  await ctx.connections.remove(ctx.userId, match.id);
  console.log(chalk.green(`✔ Removed "${match.name || match.id}".`));
}
