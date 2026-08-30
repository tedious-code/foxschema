/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OsAccountDialect, OsAccountContext, OsAccountSteps } from '../../modules/access/os-account.types.js';
import { asLinuxName, createLoginSteps, notApplicable, rootPrefix } from '../../modules/access/os-account-helpers.js';

export const oracleOsAccount: OsAccountDialect = {
  id: 'oracle',
  steps(ctx: OsAccountContext): OsAccountSteps {
    const linux = asLinuxName(ctx.name);
    if (!linux) {
      return notApplicable(
        `"${ctx.name}" is not a usable Linux login name, so external authentication cannot match it. The user still works with a password.`
      );
    }
    const prefix = rootPrefix(ctx);
    if (typeof prefix !== 'string') return notApplicable(prefix.error);

    return {
      applicable: true,
      rationale:
        'Only needed for `IDENTIFIED EXTERNALLY`. Oracle matches an OS login to a database user named os_authent_prefix + the login — OPS$ by default, so the OS user "name" pairs with the database user OPS$NAME. A user created with a password does not need one.',
      statements: [
        ...createLoginSteps(prefix, linux),
        {
          sql: `${prefix}su - oracle -c "sqlplus -S / as sysdba <<'SQL'\nSET HEADING OFF\nSELECT value FROM v\\$parameter WHERE name = 'os_authent_prefix';\nEXIT\nSQL"`,
          explanation:
            'Shows the prefix Oracle expects. The database user must be named with it in front of the OS login — OPS$ unless this returns something else.',
          risk: 'low',
        },
      ],
    };
  },
};
