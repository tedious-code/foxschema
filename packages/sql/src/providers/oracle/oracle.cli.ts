/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL*Plus.
 */
import type { CliDialect, CliTarget } from '../../modules/command-mode/cli.types.js';
import { checkTarget, commandWithSql, shellQuote } from '../../modules/command-mode/cli-helpers.js';

export const oracleCli: CliDialect = {
  id: 'oracle',
  client: 'sqlplus',
  run(sql: string, target: CliTarget) {
    const bad = checkTarget(target, ['host', 'database', 'username']);
    if (bad) return { error: bad };

    // Easy Connect: user@//host:port/service. Leaving the password out of the
    // connect string makes SQL*Plus prompt for it.
    const connect = `${target.username}@//${target.host}:${target.port ?? 1521}/${target.database}`;

    // SQL*Plus does not end a statement on a newline, and it keeps going after
    // an error unless told otherwise.
    const body = `WHENEVER SQLERROR EXIT SQL.SQLCODE\n${sql.trim().replace(/;?\s*$/, ';')}\nEXIT`;

    return commandWithSql({
      client: 'sqlplus',
      flags: ['-S', shellQuote(connect)],
      sql: body,
      explanation: `Runs the statement on ${target.database} as ${target.username}. SQL*Plus prompts for the password.`,
      auth: 'prompts',
      note: 'WHENEVER SQLERROR EXIT stops at the first error — SQL*Plus otherwise carries on. Every statement needs its terminating semicolon, and a PL/SQL block needs a lone / on the line after it.',
    });
  },
};
