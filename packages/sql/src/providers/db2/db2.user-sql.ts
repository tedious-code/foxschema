/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Db2 account DDL — roles in SQL; users are OS/directory accounts. The
 * Docker instruction builder emits copy-paste steps (never executed here).
 */
import { PASSWORD_PLACEHOLDER, type GeneratedUserSql, type UserSqlDialect } from '../../modules/access/user-sql.types.js';
import { createUserSqlEmitter } from '../../modules/access/user-sql-helpers.js';
import type { PermissionRisk } from '../../modules/access/intent.js';
import type { GeneratedStatement } from '../../modules/access/access-sql.types.js';

const DB2_REASON =
  'Db2 authenticates against the operating system or a directory service, so there is ' +
  'no CREATE USER. Create the account on the server, then grant it privileges here.';

export const db2UserSql: UserSqlDialect = {
  id: 'db2',
  support: {
    supported: true,
    canCreateUser: false,
    canCreateRole: true,
    canDisable: true,
    canRename: false,
    canExpire: false,
    reason: DB2_REASON,
  },

  build(request, dialect) {
    const { name, isUser, noun, add, q, finish } = createUserSqlEmitter(request, dialect);
    const support = this.support;

    if (request.action === 'create') {
      if (isUser) {
        return { error: support.reason ?? 'This engine cannot create users in SQL.' };
      }
      add(
        `CREATE ROLE ${q(name)};`,
        `Creates the role ${name}. A role holds privileges; grant it to users afterwards.`
      );
      return finish();
    }

    if (request.action === 'drop') {
      const risk: PermissionRisk = 'administrative';
      const keyword = isUser ? 'USER' : 'ROLE';
      add(
        `DROP ${keyword} ${q(name)};`,
        `Drops the ${noun} ${name}. Privileges granted to it are removed with it.`,
        risk
      );
      return finish();
    }

    const change = request.alteration ?? 'password';
    if (change === 'rename') {
      const next = request.newName?.trim();
      if (!next) return { error: 'Enter the new name.' };
      return {
        error: `${dialect} cannot rename an account. Create the new one and drop the old.`,
      };
    }
    if (change === 'password') {
      if (!isUser) return { error: 'A role has no password.' };
      return buildDb2OsUserInstructions({ name, action: 'password' });
    }
    if (change === 'disable') {
      if (!isUser) return { error: 'A role cannot be locked this way.' };
      return buildDb2OsUserInstructions({ name, action: 'disable' });
    }
    if (change === 'enable') {
      if (!isUser) return { error: 'A role cannot be unlocked this way.' };
      return buildDb2OsUserInstructions({ name, action: 'enable' });
    }
    if (change === 'expire') {
      if (!isUser) return { error: 'A role has no expiry date.' };
      return { error: `${dialect} cannot set account expiry in SQL.` };
    }
    return {
      error: `${dialect} cannot disable an account. Drop it, or revoke its privileges instead.`,
    };
  },
};

/** Compose container from this repo's `docker-compose.yml`. */
export const DB2_DOCKER_CONTAINER = 'foxschema-db2';
/** Default database created by that compose file. */
export const DB2_DOCKER_DATABASE = 'foxdb';

const LINUX_ACCOUNT = /^[a-z_][a-z0-9_]{0,31}$/;
const SAFE_DOCKER_NAME = /^[A-Za-z0-9._-]+$/;
const SAFE_DB_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

function linuxAccountName(raw: string): string | { error: string } {
  const linux = raw.trim().toLowerCase();
  if (!LINUX_ACCOUNT.test(linux)) {
    return {
      error:
        'Use a Linux login name: start with a letter or underscore, then letters, digits, or _ (max 32).',
    };
  }
  return linux;
}

/**
 * Copy-paste steps for an OS login in the Fox Schema Db2 container.
 * Fox Schema does not run these. Passwords stay a placeholder.
 */
export type Db2OsUserAction = 'create' | 'password' | 'disable' | 'enable';

export function buildDb2OsUserInstructions(args: {
  name: string;
  role?: string;
  container?: string;
  database?: string;
  action?: Db2OsUserAction;
}): GeneratedUserSql | { error: string } {
  const action = args.action ?? 'create';
  const linux = linuxAccountName(args.name);
  if (typeof linux !== 'string') return linux;
  const authId = linux.toUpperCase();
  const container = (args.container || DB2_DOCKER_CONTAINER).trim() || DB2_DOCKER_CONTAINER;
  const database = (args.database || DB2_DOCKER_DATABASE).trim() || DB2_DOCKER_DATABASE;
  if (!SAFE_DOCKER_NAME.test(container)) {
    return { error: 'Container name contains characters that cannot be copied into a docker exec command.' };
  }
  if (!SAFE_DB_NAME.test(database)) {
    return { error: 'Database name must be a simple identifier (letters, digits, underscore).' };
  }

  if (action === 'password') {
    return {
      statements: [
        {
          sql:
            `docker exec -u 0 ${container} bash -lc ` +
            `'echo "${linux}:${PASSWORD_PLACEHOLDER}" | chpasswd'`,
          explanation: `Sets a new OS password for ${linux}. Db2 has no ALTER USER … PASSWORD — this is the password Fox Schema will send on connect.`,
          risk: 'elevated',
        },
        {
          sql: `docker exec -u 0 ${container} passwd -S ${linux}`,
          explanation: `Shows lock/status. P = password set; L = locked (disabled).`,
          risk: 'low',
        },
      ],
      warnings: [
        {
          level: 'danger',
          message:
            `Replace ${PASSWORD_PLACEHOLDER} before running. Fox Schema never handles the password.`,
        },
      ],
      risk: 'elevated',
    };
  }

  if (action === 'disable') {
    return {
      statements: [
        {
          sql: `docker exec -u 0 ${container} passwd -l ${linux}`,
          explanation: `Locks the OS account ${linux}. Authentication fails until you unlock it (Edit → Enable).`,
          risk: 'administrative',
        },
        {
          sql:
            `docker exec ${container} su - db2inst1 -c ` +
            `"db2 connect to ${database} && db2 'REVOKE CONNECT ON DATABASE FROM USER ${authId}'"`,
          explanation: `Also takes away CONNECT on ${database}. ${authId} cannot attach even if the OS lock is later skipped.`,
          risk: 'elevated',
        },
        {
          sql: `docker exec -u 0 ${container} passwd -S ${linux}`,
          explanation: `Confirm LK / L in the status. Locked means disable worked.`,
          risk: 'low',
        },
        {
          sql:
            `SELECT TRIM(GRANTEE) AS authid, CONNECTAUTH\n` +
            `FROM SYSCAT.DBAUTH\n` +
            `WHERE GRANTEETYPE = 'U' AND TRIM(GRANTEE) = '${authId}';`,
          explanation: `CONNECTAUTH N (or no row) means ${authId} cannot connect to ${database}.`,
          risk: 'low',
        },
      ],
      warnings: [
        {
          level: 'caution',
          message:
            'Disable is two layers: OS lock (passwd -l) and REVOKE CONNECT. Enable runs the reverse. Table GRANTs stay until you revoke them separately.',
        },
      ],
      risk: 'administrative',
    };
  }

  if (action === 'enable') {
    return {
      statements: [
        {
          sql: `docker exec -u 0 ${container} passwd -u ${linux}`,
          explanation: `Unlocks the OS account ${linux} so the password works again.`,
          risk: 'elevated',
        },
        {
          sql:
            `docker exec ${container} su - db2inst1 -c ` +
            `"db2 connect to ${database} && db2 'GRANT CONNECT ON DATABASE TO USER ${authId}'"`,
          explanation: `Restores CONNECT on ${database}. Table privileges from before disable are unchanged.`,
          risk: 'elevated',
        },
        {
          sql: `docker exec -u 0 ${container} passwd -S ${linux}`,
          explanation: `Status should show P (password set), not L (locked).`,
          risk: 'low',
        },
      ],
      warnings: [
        {
          level: 'info',
          message: `Db2 authorization ID is ${authId}. If login still fails, set a password (Edit → Password) after unlocking.`,
        },
      ],
      risk: 'elevated',
    };
  }

  let roleAuth: string | undefined;
  const roleRaw = args.role?.trim();
  if (roleRaw) {
    const roleLinux = linuxAccountName(roleRaw);
    if (typeof roleLinux !== 'string') {
      return { error: 'Role name must use the same characters as a Linux login (letters, digits, underscore).' };
    }
    roleAuth = roleLinux.toUpperCase();
  }

  const statements: GeneratedStatement[] = [
    {
      sql:
        `docker exec -u 0 ${container} bash -lc ` +
        `'id ${linux} >/dev/null 2>&1 || useradd -m -s /bin/bash ${linux}'`,
      explanation: `Creates the OS login ${linux} inside ${container}. Db2 authenticates this name; there is no CREATE USER.`,
      risk: 'elevated',
    },
    {
      sql:
        `docker exec -u 0 ${container} bash -lc ` +
        `'echo "${linux}:${PASSWORD_PLACEHOLDER}" | chpasswd'`,
      explanation: `Sets the OS password for ${linux}. Replace ${PASSWORD_PLACEHOLDER} before running.`,
      risk: 'elevated',
    },
    {
      sql:
        `docker exec ${container} su - db2inst1 -c ` +
        `"db2 connect to ${database} && db2 'GRANT CONNECT ON DATABASE TO USER ${authId}'"`,
      explanation: `Lets ${authId} connect to ${database}. Until this runs, Fox Schema will not list the account.`,
      risk: 'elevated',
    },
  ];

  if (roleAuth) {
    statements.push({
      sql:
        `docker exec ${container} su - db2inst1 -c ` +
        `"db2 connect to ${database} && db2 'GRANT ROLE ${roleAuth} TO USER ${authId}'"`,
      explanation: `Assigns role ${roleAuth} to ${authId}. Create the role first with Add role if it does not exist.`,
      risk: 'elevated',
    });
  }

  statements.push(
    {
      sql: `docker exec -u 0 ${container} getent passwd ${linux}`,
      explanation: `Lists the OS account. You should see ${linux} in the passwd line.`,
      risk: 'low',
    },
    {
      sql:
        `SELECT TRIM(GRANTEE) AS authid, CONNECTAUTH\n` +
        `FROM SYSCAT.DBAUTH\n` +
        `WHERE GRANTEETYPE = 'U' AND TRIM(GRANTEE) = '${authId}';`,
      explanation: `Run in SQL Editor as db2inst1. CONNECTAUTH Y or G means ${authId} can log in.`,
      risk: 'low',
    },
    {
      sql:
        `SELECT TRIM(ROLENAME) AS role\n` +
        `FROM SYSCAT.ROLEAUTH\n` +
        `WHERE GRANTEETYPE = 'U' AND TRIM(GRANTEE) = '${authId}';`,
      explanation: `Roles granted to ${authId}. Reload User Management after CONNECT so the user appears in the list.`,
      risk: 'low',
    }
  );

  return {
    statements,
    warnings: [
      {
        level: 'danger',
        message:
          `Replace ${PASSWORD_PLACEHOLDER} with a real OS password before running chpasswd. Fox Schema ` +
          'never handles the password.',
      },
      {
        level: 'info',
        message:
          `Db2 authorization ID is ${authId} (uppercase of the Linux name). Use Grant access next for table privileges.`,
      },
    ],
    risk: 'elevated',
  };
}
