/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CliDialect, CliTarget } from '../../modules/command-mode/cli.types.js';
import { checkTarget, commandWithSql, shellQuote } from '../../modules/command-mode/cli-helpers.js';

export const clickHouseCli: CliDialect = {
  id: 'clickhouse',
  client: 'clickhouse-client',
  run(sql: string, target: CliTarget) {
    const bad = checkTarget(target, ['host', 'database', 'username']);
    if (bad) return { error: bad };

    return commandWithSql({
      client: 'clickhouse-client',
      flags: [
        '--host', shellQuote(String(target.host)),
        // 9000 is the native protocol port; 8123 is HTTP and this client does
        // not speak it.
        '--port', String(target.port ?? 9000),
        '--user', shellQuote(String(target.username)),
        '--database', shellQuote(String(target.database)),
        // No --ask-password. It prompts, and the prompt reads stdin — which
        // the here-document already occupies, so the client would take the
        // script's first line as the password. CLICKHOUSE_PASSWORD carries it
        // instead and nothing secret goes on the command line.
        // Without this the client stops at the first statement in the stream.
        '--multiquery',
      ],
      sql,
      explanation: `Runs the statement on ${target.database} as ${target.username}. Export CLICKHOUSE_PASSWORD first — the client cannot prompt here.`,
      auth: 'environment',
      envVar: 'CLICKHOUSE_PASSWORD',
      note: 'The client cannot prompt here: its prompt reads stdin, which the here-document uses. --port is the native protocol (9000), not the HTTP port (8123) Fox Schema itself connects on.',
    });
  },
};
