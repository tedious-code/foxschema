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

/**
 * The command that runs `sql` against `target` using `dialect`'s own client.
 *
 * Returns `{ error }` rather than an approximation when the dialect has no
 * client or the connection details cannot be put on a command line — a command
 * that is nearly right is worse than none, because it will be pasted into a
 * terminal and run.
 */
/**
 * Where each engine's client lives inside its own official image.
 *
 * Keyed by dialect, not by emitter: MariaDB and TiDB share the MySQL emitter,
 * and CockroachDB, YugabyteDB and Redshift share the PostgreSQL one, so putting
 * this on the emitter would apply one image's layout to another's.
 *
 * Verified against the running images: MariaDB 11 renamed its client to
 * `mariadb` and ships no `mysql`; YugabyteDB ships `ysqlsh`, a psql fork that
 * takes the same flags; the mssql images keep sqlcmd in /opt/mssql-tools18/bin.
 */
const DOCKER_CLIENT: Record<string, string> = {
  sqlserver: '/opt/mssql-tools18/bin/sqlcmd',
  azuresql: '/opt/mssql-tools18/bin/sqlcmd',
  mariadb: 'mariadb',
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
  return {
    ...built,
    ...(DOCKER_CLIENT[key] ? { dockerClient: DOCKER_CLIENT[key] } : {}),
    ...(DOCKER_FLAGS[key] ? { dockerFlags: DOCKER_FLAGS[key] } : {}),
    ...(NO_DOCKER_CLIENT[key] ? { dockerUnsupported: NO_DOCKER_CLIENT[key] } : {}),
  };
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
