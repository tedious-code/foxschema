/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Command mode: the shell command that runs a statement through the engine's
 * own client, for someone who would rather paste it into a terminal than let
 * Fox Schema execute it.
 *
 * Two rules shape everything here.
 *
 * **The password never appears.** Fox Schema does not hold it client-side, and
 * a password on a command line is visible in `ps` and kept in shell history.
 * Every emitter produces a command that prompts instead, and names the
 * environment variable to use when a prompt is not possible.
 *
 * **The SQL is never re-quoted.** It goes through a quoted heredoc, which the
 * shell passes through verbatim — no expansion, no escaping, and multi-line
 * statements survive intact. SQL is full of single quotes, and `-c '…'` with
 * hand-rolled escaping is where that goes wrong.
 */

/** Where the command should connect. Never carries a password. */
export interface CliTarget {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  schema?: string;
  /** Path to the file, for the engines whose database is a file. */
  file?: string;
}

export interface GeneratedCommand {
  /** The command to copy, invocation and statement together. */
  command: string;
  /**
   * The client and its flags, without the statement.
   *
   * Kept apart from {@link body} so the command can be re-wrapped — put inside
   * `docker exec`, or written into a script — without taking a string apart
   * again to find where the heredoc starts.
   */
  invocation: string;
  /** The statement, exactly as it will reach the client on stdin. */
  body: string;
  /** What it does, in a sentence. */
  explanation: string;
  /** The client binary this needs installed. */
  client: string;
  /**
   * How the command gets a password, so the UI can say it before the user
   * runs something that appears to hang on a prompt.
   */
  auth: 'prompts' | 'environment' | 'none';
  /** Set this first when `auth` is `environment`. */
  envVar?: string;
  /** Anything surprising about this engine's client. */
  note?: string;
}

export interface CliDialect {
  id: string;
  /** The client binary, for the "you need X installed" line. */
  client: string;
  /** A command that runs `sql` against `target`. */
  run(sql: string, target: CliTarget): GeneratedCommand | { error: string };
}
