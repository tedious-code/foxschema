#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { runSetup } from './commands/setup';
import { runDoctor } from './commands/doctor';
import { addConnection, listConnections, removeConnection } from './commands/connections';
import { runCompare } from './commands/compare';
import { runSnapshot } from './commands/snapshot';
import { runMigrate } from './commands/migrate';
import { runSearch } from './commands/search';
import { listHistory, showHistory } from './commands/history';
import { VERSION } from './version';

/** Shared connection-ref options (saved name or inline) for single-connection commands. */
function withRefOptions(cmd: import('commander').Command): import('commander').Command {
  return cmd
    .option('--connection <name>', 'saved connection name or id')
    .option('--dialect <dialect>', 'inline: dialect (db2/postgres/mysql)')
    .option('--host <host>', 'inline: host')
    .option('--port <port>', 'inline: port')
    .option('--database <database>', 'inline: database')
    .option('--user <user>', 'inline: username')
    .option('--schema <schema>', 'schema/namespace')
    .option('--url <conn-string>', 'inline: full connection string');
}

const program = new Command();

program
  .name('fox')
  .description('Fox schema cli — database schema diff & migration, in your terminal')
  .version(VERSION, '-v, --version');

program
  .command('version')
  .description('Show the version and runtime info')
  .action(() => {
    console.log(`Fox CLI ${chalk.bold('v' + VERSION)}`);
    console.log(chalk.dim(`node ${process.version} · ${process.platform} ${process.arch}`));
  });

program
  .command('setup')
  .description('Configure this install (email-bound encryption key in the OS keychain)')
  .option('--email <email>', 'email to bind the encryption key to')
  .action((opts) => runSetup(opts));

program
  .command('doctor')
  .description('Show environment, engine wiring, and setup status')
  .action(() => runDoctor());

// Surface upcoming commands so `--help` shows the roadmap. Each lands in a later
// milestone; calling one now exits non-zero with a clear note.
const soon = (milestone: string) => () => {
  console.error(chalk.yellow(`Not implemented yet — coming in ${milestone}.`));
  process.exitCode = 1;
};
const connections = program.command('connections').description('Manage saved connections (credentials encrypted at rest)');
connections.command('list').description('List saved connections').action(() => listConnections());
connections
  .command('add')
  .description('Save a new connection (password is prompted, never a flag)')
  .option('--name <name>')
  .option('--dialect <dialect>')
  .option('--host <host>')
  .option('--port <port>')
  .option('--database <database>')
  .option('--user <user>')
  .option('--schema <schema>')
  .action((opts) => addConnection(opts));
connections
  .command('remove <nameOrId>')
  .description('Delete a saved connection')
  .action((nameOrId) => removeConnection(nameOrId));

program
  .command('compare')
  .description('Diff two schemas (exit 0 = identical, 1 = drift)')
  .requiredOption('--source <name>', 'source saved-connection name or id')
  .requiredOption('--target <name>', 'target saved-connection name or id')
  .option('--source-schema <schema>', 'override the source schema')
  .option('--target-schema <schema>', 'override the target schema')
  .option('--scope <types>', 'comma list: tables,views,functions,procedures,triggers,sequences,types,mqts,roles')
  .option('--json', 'output the full comparison as JSON')
  .option('--ddl', 'output the migration DDL for the differences')
  .option('--no-fail', 'always exit 0, even when there is drift')
  .action((opts) => runCompare(opts));

withRefOptions(program.command('search <term>'))
  .description('Search a schema for objects/columns/indexes/FKs/triggers')
  .option('--scope <types>', 'narrow to object types (comma list)')
  .option('--json', 'output matches as JSON')
  .option('--case-sensitive', 'case-sensitive match')
  .action((term, opts) => runSearch(term, opts));

withRefOptions(program.command('snapshot'))
  .description('Dump a schema as DDL (stdout or --out file)')
  .option('--scope <types>', 'narrow to object types (comma list)')
  .option('--out <file>', 'write to a file instead of stdout')
  .action((opts) => runSnapshot(opts));

program
  .command('migrate')
  .description('Diff source→target and apply the changes to the target')
  .requiredOption('--source <name>', 'source saved-connection name or id')
  .requiredOption('--target <name>', 'target saved-connection name or id')
  .option('--source-schema <schema>', 'override the source schema')
  .option('--target-schema <schema>', 'override the target schema')
  .option('--scope <types>', 'narrow to object types (comma list)')
  .option('--execute', 'apply the migration (default is a dry run)')
  .option('--yes', 'skip the confirmation prompt')
  .action((opts) => runMigrate(opts));

const history = program.command('history').description('Migration run history');
history.command('list').description('List recent migration runs').action(() => listHistory());
history.command('show <id>').description('Show a migration run in detail').action((id) => showHistory(id));
program.command('tui').description('Launch the interactive terminal UI [M4]').action(soon('M4'));

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
