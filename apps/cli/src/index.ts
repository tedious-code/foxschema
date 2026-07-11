#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { friendlyError } from './format/friendlyError';
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
  .description('Fox Schema CLI — database schema diff & migration, in your terminal')
  .version(VERSION, '-v, --version')
  .showSuggestionAfterError()
  .addHelpText(
    'after',
    `
Examples:
  $ fox                                             Open the interactive UI
  $ fox connections add                             Save a connection (prompts for details)
  $ fox compare --source prod --target staging      Diff two saved connections
  $ fox migrate --source prod --target staging      Dry run — preview the migration SQL
  $ fox migrate --source prod --target staging --execute --yes
                                                     Apply the migration without confirming
  $ fox compare --source prod --target staging --json --no-fail > diff.json
                                                     CI-friendly JSON, always exit 0
`
  );

program
  .command('version')
  .description('Show the version and runtime info')
  .action(() => {
    console.log(`Fox Schema CLI ${chalk.bold('v' + VERSION)}`);
    console.log(chalk.dim(`node ${process.version} · ${process.platform} ${process.arch}`));
    console.log(chalk.dim('foxschema.com'));
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
  .option('--source <name>', 'source saved-connection name or id (prompted if omitted in a terminal)')
  .option('--target <name>', 'target saved-connection name or id (prompted if omitted in a terminal)')
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
  .option('--source <name>', 'source saved-connection name or id (prompted if omitted in a terminal)')
  .option('--target <name>', 'target saved-connection name or id (prompted if omitted in a terminal)')
  .option('--source-schema <schema>', 'override the source schema')
  .option('--target-schema <schema>', 'override the target schema')
  .option('--scope <types>', 'narrow to object types (comma list)')
  .option('--execute', 'apply the migration (default is a dry run)')
  .option('--yes', 'skip the confirmation prompt')
  .option('--continue-on-error', 'skip a failed object and continue instead of rolling back the whole run')
  .action((opts) => runMigrate(opts));

const history = program.command('history').description('Migration run history');
history.command('list').description('List recent migration runs').action(() => listHistory());
history.command('show <id>').description('Show a migration run in detail').action((id) => showHistory(id));
// A *computed* import target, not a string literal — this is deliberate, not
// stylistic. esbuild can only inline a dynamic import() whose specifier is a
// literal string; it always leaves a computed one as an opaque runtime call.
// That matters because the tui/ subtree is built as its own separate ESM
// bundle (see build.mjs / build-binary.mjs) rather than inlined into this
// file: Ink's own screens statically `import {Box} from 'ink'`, and if
// those ended up bundled into *this* CJS-capable entry point, esbuild would
// rewrite every one of those into a synchronous `require('ink')` the moment
// any screen's module executes — which fails outright in the compiled SEA
// binary, since ink's own yoga-layout dependency has a top-level `await` in
// its ESM entry, and Node's require(esm) interop cannot evaluate that
// synchronously (confirmed by reproducing it directly against a real
// esbuild CJS bundle). Resolving relative to import.meta.url — which
// becomes an execPath-relative runtime value in the SEA build via that
// build's own `define` — is what lets the exact same source resolve
// correctly across dev (tsx), the plain ESM build, and the SEA binary.
async function launchTui(): Promise<void> {
  const tuiEntry = new URL('./tui/index.js', import.meta.url).href;
  const { runTui } = await import(tuiEntry);
  await runTui();
}

program
  .command('tui')
  .description('Launch the interactive terminal UI')
  .action(() => launchTui());

// A bare `fox` (no subcommand, no flags) opens the friendlier interactive UI
// instead of printing commander's help — that's the on-ramp for a new user.
// `fox --help`/`-h` and any real subcommand still go through commander as usual.
const bareInvocation = process.argv.length <= 2;

(bareInvocation ? launchTui() : program.parseAsync(process.argv)).catch((err) => {
  console.error(chalk.red(friendlyError(err)));
  process.exit(1);
});
