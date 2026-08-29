/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The db2 CLP, which connects before it can run anything.
 */
import type { CliDialect, CliTarget } from '../../modules/command-mode/cli.types.js';
import { checkTarget, commandWithSql, shellQuote } from '../../modules/command-mode/cli-helpers.js';

export const db2Cli: CliDialect = {
  id: 'db2',
  client: 'db2',
  run(sql: string, target: CliTarget) {
    const bad = checkTarget(target, ['database', 'username']);
    if (bad) return { error: bad };

    // The CLP has no host flag: it connects to a catalogued database alias.
    // CONNECT USING without a password makes it prompt.
    const connect = `CONNECT TO ${target.database} USER ${target.username};`;
    const body = `${connect}\n${sql.trim().replace(/;?\s*$/, ';')}\nCONNECT RESET;`;

    return commandWithSql({
      client: 'db2',
      // -t ends statements on ';', -v echoes them, -s stops on the first error.
      flags: ['-tvs'],
      sql: body,
      explanation: `Connects to ${target.database} as ${target.username} and runs the statement. The CLP prompts for the password.`,
      auth: 'prompts',
      note: `The db2 CLP talks to a catalogued alias, not a host and port. If ${target.database} is not catalogued locally, run this on the server, or catalog the node and database first.`,
    });
  },
};
