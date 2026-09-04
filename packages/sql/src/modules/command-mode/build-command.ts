/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The entry point for command mode: SQL plus a connection, out comes the
 * shell command that runs it.
 */
import type { CliTarget, GeneratedCommand } from './cli.types.js';
import { cliFor } from './cli.registry.js';
import { heredoc } from './shell.js';

/**
 * The command that runs `sql` against `target` using `dialect`'s own client.
 *
 * Returns `{ error }` rather than an approximation when the dialect has no
 * client or the connection details cannot be put on a command line — a command
 * that is nearly right is worse than none, because it will be pasted into a
 * terminal and run.
 */
/**
 * The client's real name for a dialect whose emitter is named after another.
 *
 * This is not a Docker concern, and treating it as one was a bug: MariaDB 11
 * renamed the client to `mariadb` and ships no `mysql` at all — not even a
 * symlink, verified against MariaDB 11.8. Someone with MariaDB installed and
 * the raw command in their terminal gets `mysql: command not found`, which is
 * the same failure the Docker form was already fixed for.
 *
 * YugabyteDB deliberately stays out of this table. Its image ships no psql, so
 * the Docker form needs `ysqlsh` — but YugabyteDB speaks the PostgreSQL wire
 * protocol, so a host with psql and no ysqlsh connects fine, and naming ysqlsh
 * everywhere would break that reader instead. Where the client lives inside an
 * image belongs below; what the client is called belongs here.
 *
 * Keyed by dialect, not by emitter: MariaDB and TiDB share the MySQL emitter,
 * and CockroachDB, YugabyteDB and Redshift share the PostgreSQL one, so putting
 * this on the emitter would apply one engine's naming to another's.
 */
const DIALECT_CLIENT: Record<string, string> = {
  mariadb: 'mariadb',
};

/**
 * Where each engine's client lives inside its own official image.
 *
 * Only for clients that are present but not on PATH there — the mssql images
 * keep sqlcmd in /opt/mssql-tools18/bin — or absent under the expected name,
 * as with YugabyteDB's `ysqlsh`. A client with a different *name* belongs in
 * {@link DIALECT_CLIENT} instead, so every format gets it, not just this one.
 */
const DOCKER_CLIENT: Record<string, string> = {
  sqlserver: '/opt/mssql-tools18/bin/sqlcmd',
  azuresql: '/opt/mssql-tools18/bin/sqlcmd',
  yugabytedb: 'ysqlsh',
};

/** Flags that only make sense against a local container. */
const DOCKER_FLAGS: Record<string, string[]> = {
  // sqlcmd 18 encrypts by default and refuses a container's self-signed
  // certificate outright, so without -C it cannot connect at all.
  sqlserver: ['-C'],
  azuresql: ['-C'],
};

/**
 * Images that ship no client this emitter can drive, with the reason.
 *
 * Saying so beats emitting a command that dies with "executable file not found
 * in $PATH" — the reader cannot tell from that whether the tool is wrong or the
 * image is.
 */
const NO_DOCKER_CLIENT: Record<string, string> = {
  cockroachdb:
    'The CockroachDB image ships `cockroach sql`, which does not take psql\'s flags. Run the command from a machine with psql — CockroachDB speaks the PostgreSQL wire protocol, so psql works against it.',
  tidb: 'The TiDB image ships no SQL client. Run the command from a machine that has the mysql client.',
};

export function buildCliCommand(
  sql: string,
  dialect: string,
  target: CliTarget
): GeneratedCommand | { error: string } {
  if (!sql.trim()) return { error: 'There is no SQL to run yet.' };

  const key = (dialect || '').toLowerCase();
  const cli = cliFor(dialect);
  if (!cli) {
    return {
      error: `Command mode has no client for ${dialect || 'this engine'}. MongoDB and Redis do not take SQL, so there is nothing to hand to one.`,
    };
  }
  const built = cli.run(sql, target);
  if ('error' in built) return built;

  // Attached here rather than in the emitter, because several dialects share
  // one emitter but run in different images.
  const renamed = renameClient(built, DIALECT_CLIENT[key]);
  if ('error' in renamed) return renamed;
  return {
    ...renamed,
    ...(DOCKER_CLIENT[key] ? { dockerClient: DOCKER_CLIENT[key] } : {}),
    ...(DOCKER_FLAGS[key] ? { dockerFlags: DOCKER_FLAGS[key] } : {}),
    ...(NO_DOCKER_CLIENT[key] ? { dockerUnsupported: NO_DOCKER_CLIENT[key] } : {}),
  };
}

/**
 * The same command with the client renamed, for every format.
 *
 * The invocation is rewritten and the command rebuilt from it through
 * {@link heredoc}, rather than replacing the name in the finished string: the
 * statement is in there too, and a body mentioning `mysql` would otherwise be
 * rewritten along with the client.
 */
function renameClient(
  built: GeneratedCommand,
  client: string | undefined
): GeneratedCommand | { error: string } {
  if (!client || client === built.client) return built;
  // Only the leading word is the client; the flags follow it.
  const invocation = `${client}${built.invocation.slice(built.client.length)}`;
  const command = heredoc(invocation, built.body);
  if (typeof command !== 'string') return command;
  return { ...built, client, invocation, command };
}

/**
 * The whole thing as one block to copy: how to supply the password, then the
 * command.
 *
 * Kept separate from {@link buildCliCommand} so a caller that renders the
 * parts itself is not forced through string assembly.
 */
export function renderCliCommand(generated: GeneratedCommand): string {
  const lines: string[] = [];
  if (generated.auth === 'environment' && generated.envVar) {
    // Not "or let it prompt": the statement arrives on stdin through a
    // here-document, so no client here can read a prompt.
    lines.push(`# export ${generated.envVar}=…   # the client cannot prompt here`);
  }
  lines.push(generated.command);
  return lines.join('\n');
}
