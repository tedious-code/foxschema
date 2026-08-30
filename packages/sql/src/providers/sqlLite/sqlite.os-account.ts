/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OsAccountDialect, OsAccountContext, OsAccountSteps } from '../../modules/access/os-account.types.js';
import { asLinuxName, createLoginSteps, notApplicable, rootPrefix } from '../../modules/access/os-account-helpers.js';

export const sqliteOsAccount: OsAccountDialect = {
  id: 'sqlite',
  steps(ctx: OsAccountContext): OsAccountSteps {
    const linux = asLinuxName(ctx.name);
    if (!linux) {
      return notApplicable(`"${ctx.name}" is not a usable Linux login name.`);
    }
    const prefix = rootPrefix(ctx);
    if (typeof prefix !== 'string') return notApplicable(prefix.error);
    const file = (ctx.database ?? '').trim();

    return {
      applicable: true,
      rationale:
        'The database has no accounts at all — file permissions are the only access control. Who may read or write is decided by ownership and mode on the file, so the OS account is not an extra layer here, it is the whole of it.',
      statements: [
        ...createLoginSteps(prefix, linux),
        ...(file
          ? [
              {
                sql: `${prefix}chown ${linux} ${file}`,
                explanation: `Gives ${linux} ownership of the database file. Without write permission the account can read but not change anything.`,
                risk: 'elevated' as const,
              },
              {
                sql: `${prefix}bash -lc "ls -l ${file} && ls -ld $(dirname ${file})"`,
                explanation:
                  'Shows the file and its directory. SQLite writes a journal beside the database, so the directory must be writable too, not just the file.',
                risk: 'low' as const,
              },
            ]
          : [
              {
                sql: `${prefix}bash -lc 'echo "Choose the database file first — ownership is set per file."'`,
                explanation: 'No file path is known for this connection yet.',
                risk: 'low' as const,
              },
            ]),
      ],
    };
  },
};
