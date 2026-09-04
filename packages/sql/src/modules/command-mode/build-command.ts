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
export function buildCliCommand(
  sql: string,
  dialect: string,
  target: CliTarget
): GeneratedCommand | { error: string } {
  if (!sql.trim()) return { error: 'There is no SQL to run yet.' };

  const cli = cliFor(dialect);
  if (!cli) {
    return {
      error: `Command mode has no client for ${dialect || 'this engine'}. MongoDB and Redis do not take SQL, so there is nothing to hand to one.`,
    };
  }
  return cli.run(sql, target);
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
