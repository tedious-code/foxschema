/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The mysql client, shared with MariaDB and TiDB.
 */
import type { CliDialect, CliTarget } from '../../modules/command-mode/cli.types.js';
import { checkTarget, commandWithSql, shellQuote } from '../../modules/command-mode/cli-helpers.js';

export const mysqlCli: CliDialect = {
  id: 'mysql',
  client: 'mysql',
  run(sql: string, target: CliTarget) {
    const bad = checkTarget(target, ['host', 'database', 'username']);
    if (bad) return { error: bad };

    return commandWithSql({
      client: 'mysql',
      flags: [
        '-h', shellQuote(String(target.host)),
        '-P', String(target.port ?? 3306),
        '-u', shellQuote(String(target.username)),
        // -p with no value makes the client prompt. Attaching the password
        // here would put it in `ps` output and shell history.
        '-p',
        shellQuote(String(target.database)),
      ],
      sql,
      explanation: `Runs the statement on ${target.database} as ${target.username}. The client prompts for the password.`,
      auth: 'prompts',
      envVar: 'MYSQL_PWD',
      note: 'MySQL has no schema layer separate from the database, so the database name is the schema.',
    });
  },
};
