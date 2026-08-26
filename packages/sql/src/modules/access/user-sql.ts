/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * DDL for database accounts: create, alter and drop a user or a role.
 *
 * This generates SQL and nothing else. Fox Schema does not create accounts —
 * the statements are shown to a DBA to review and run. That is why there is no
 * matching execute path and no capability here for applying anything.
 *
 * ## Passwords are never handled
 *
 * A password belongs in the DBA's hands, not in a browser tab, a React state
 * tree or a history record. Statements that need one are emitted with the
 * {@link PASSWORD_PLACEHOLDER} in its place and a warning to substitute it
 * before running. Nothing here accepts a password argument, so there is no path
 * by which one could be stored or logged.
 *
 * ## A user is not a role
 *
 * The two are separate on every engine that has both, and conflating them is
 * the usual source of confusion: a role holds privileges, a user logs in.
 * {@link PrincipalType} makes the caller choose, and the emitters differ
 * accordingly — most visibly on SQL Server, where a login and a database user
 * are two objects and creating an account means creating both.
 */
import { accessFamily, type PermissionRisk } from './intent.js';
import type { GeneratedStatement, PermissionWarning } from './access-sql.js';
import { quoteSqlIdentifier } from '../sql-text/sql-template.js';

/** What the caller is operating on. */
export type PrincipalType = 'user' | 'role';

export type UserAction = 'create' | 'alter' | 'drop';

/** The change an `alter` is asking for. */
export type UserAlteration =
  /** Set a new password. */
  | 'password'
  /** Rename the account. */
  | 'rename'
  /** Refuse new connections without dropping anything. */
  | 'disable'
  /** Allow connections again. */
  | 'enable';

/**
 * A setting that can be applied when an account is created.
 *
 * Engines disagree on both which of these exist and how they are written, so
 * the UI asks the dialect what it can offer rather than showing every field and
 * discarding the ones that do not apply.
 */
export type UserOptionKey =
  /** MySQL-family host part — the account is user *and* host. */
  | 'host'
  /** Account may create databases. */
  | 'createDb'
  /** Account may create other accounts. */
  | 'createRole'
  /** Full administrative rights. */
  | 'superuser'
  /** Maximum concurrent connections. */
  | 'connectionLimit'
  /** Date the password stops working. */
  | 'validUntil'
  /** Force a password change at first login. */
  | 'mustChangePassword'
  /** Created locked, to be unlocked once set up. */
  | 'startLocked'
  /** Oracle tablespace for the account's objects. */
  | 'defaultTablespace'
  /** SQL Server database the login lands in. */
  | 'defaultDatabase';

export interface UserOptionDescriptor {
  key: UserOptionKey;
  /** Field label, written for someone who is not a DBA. */
  label: string;
  kind: 'boolean' | 'text' | 'number' | 'date';
  placeholder?: string;
  /** What choosing it does, and anything surprising about it. */
  hint?: string;
}

export type UserOptions = Partial<Record<UserOptionKey, string | number | boolean>>;

const OPTIONS: Record<string, UserOptionDescriptor[]> = {
  postgres: [
    { key: 'createDb', label: 'May create databases', kind: 'boolean' },
    { key: 'createRole', label: 'May create other accounts', kind: 'boolean' },
    {
      key: 'superuser',
      label: 'Superuser',
      kind: 'boolean',
      hint: 'Bypasses every permission check, including the ones set here.',
    },
    {
      key: 'connectionLimit',
      label: 'Connection limit',
      kind: 'number',
      placeholder: 'unlimited',
    },
    {
      key: 'validUntil',
      label: 'Password valid until',
      kind: 'date',
      hint: 'After this date the password stops working. The account itself remains.',
    },
  ],
  mysql: [
    {
      key: 'host',
      label: 'Connects from',
      kind: 'text',
      placeholder: '%',
      hint: 'Part of the account\u2019s identity: the same name from another host is a different account. % means anywhere.',
    },
    {
      key: 'mustChangePassword',
      label: 'Must change password at first login',
      kind: 'boolean',
    },
    { key: 'startLocked', label: 'Create locked', kind: 'boolean' },
  ],
  sqlserver: [
    { key: 'defaultDatabase', label: 'Default database', kind: 'text', placeholder: 'master' },
    {
      key: 'mustChangePassword',
      label: 'Must change password at first login',
      kind: 'boolean',
      hint: 'SQL Server requires password policy and expiration to be enforced for this, so both are added with it.',
    },
    { key: 'startLocked', label: 'Create disabled', kind: 'boolean' },
  ],
  oracle: [
    { key: 'defaultTablespace', label: 'Default tablespace', kind: 'text', placeholder: 'USERS' },
    { key: 'mustChangePassword', label: 'Password expired at first login', kind: 'boolean' },
    { key: 'startLocked', label: 'Create locked', kind: 'boolean' },
  ],
  clickhouse: [],
  db2: [],
};

/**
 * The settings this engine accepts when creating this kind of principal.
 *
 * Empty when the engine offers none worth exposing — the caller should render
 * no options section rather than an empty one.
 */
export function createUserOptions(
  dialect: string,
  principalType: PrincipalType = 'user'
): UserOptionDescriptor[] {
  const d = (dialect || '').toLowerCase();
  if (NO_ACCOUNTS.has(d)) return [];
  if (d === 'redshift') {
    // Redshift is Postgres-shaped but has no SUPERUSER or CREATEROLE keyword.
    return OPTIONS.postgres!.filter((o) => o.key === 'createDb' || o.key === 'connectionLimit' || o.key === 'validUntil');
  }
  const all = OPTIONS[accessFamily(d)] ?? [];
  if (principalType === 'role') {
    // A role holds privileges and does not connect, so the login-shaped
    // settings do not apply to it.
    return all.filter((o) => o.key === 'createDb' || o.key === 'createRole' || o.key === 'superuser');
  }
  return all;
}

export interface UserRequest {
  action: UserAction;
  principalType: PrincipalType;
  /** The account being created, altered or dropped. */
  name: string;
  /** For `alter` + `rename`. */
  newName?: string;
  /** For `alter`: which change. Ignored for create and drop. */
  alteration?: UserAlteration;
  /**
   * MySQL-family host part, e.g. `%` or `localhost`. A MySQL account is
   * identified by user *and* host, so the wrong host is a different account.
   */
  host?: string;
  /** Drop objects the account owns as well. Oracle needs this to drop at all. */
  cascade?: boolean;
  /**
   * The password to write into the statement.
   *
   * Omitted, the statement carries {@link PASSWORD_PLACEHOLDER} for the user to
   * replace by hand. Supplied, it is rendered by
   * {@link renderPasswordLiteral} and the result is a live secret: the caller
   * must not store it, log it, or put it in history.
   */
  password?: string;
  /** Settings from {@link createUserOptions} for this dialect. */
  options?: UserOptions;
}

export interface GeneratedUserSql {
  statements: GeneratedStatement[];
  warnings: PermissionWarning[];
  risk: PermissionRisk;
}

/**
 * A password rendered as a SQL literal for `dialect`, or a refusal.
 *
 * This is the one place caller text is placed inside generated DDL, and the
 * statement is meant to be run by hand against a live server with
 * administrative rights — so it fails closed. A password it cannot represent
 * exactly is refused rather than escaped approximately.
 *
 * The rules differ by engine:
 *
 *  - Single-quoted literals double an embedded quote.
 *  - MySQL also treats a backslash as an escape character unless the server
 *    runs with NO_BACKSLASH_ESCAPES, so a backslash has to be doubled too.
 *  - Oracle takes the password as a quoted identifier, and a quoted identifier
 *    has no escape for a double quote at all — such a password is refused.
 *
 * Control characters are refused everywhere: they cannot survive a copied
 * statement intact, and a newline would split it into two.
 */
export function renderPasswordLiteral(
  password: string,
  dialect: string
): { sql: string } | { error: string } {
  if (password.length === 0) return { error: 'Enter a password.' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(password)) {
    return { error: 'The password contains a control character or line break, which cannot be written into a statement.' };
  }

  const family = accessFamily(dialect);
  if (family === 'oracle') {
    if (password.includes('"')) {
      return {
        error:
          'Oracle takes the password as a quoted identifier, which cannot contain a double ' +
          'quote. Choose a password without one.',
      };
    }
    return { sql: `"${password}"` };
  }

  const escaped =
    family === 'mysql'
      ? password.replace(/\\/g, '\\\\').replace(/'/g, "''")
      : password.replace(/'/g, "''");
  return { sql: `'${escaped}'` };
}

/** Stands in for a real password, which this module never sees. */
export const PASSWORD_PLACEHOLDER = '<password>';

/** Engines with no account model reachable through SQL. */
const NO_ACCOUNTS = new Set(['sqlite', 'duckdb', 'mongodb', 'redis']);

export interface UserManagementSupport {
  /** False when the engine has no SQL-reachable accounts at all. */
  supported: boolean;
  /** False when the engine has users but they cannot be created in SQL. */
  canCreateUser: boolean;
  canCreateRole: boolean;
  /** True where an account may be disabled instead of dropped. */
  canDisable: boolean;
  canRename: boolean;
  /** Shown when something is unavailable, so the UI can say why. */
  reason?: string;
}

const SUPPORT: Record<string, UserManagementSupport> = {
  postgres: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: true,
    canRename: true,
  },
  mysql: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: true,
    canRename: true,
  },
  sqlserver: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: true,
    canRename: true,
  },
  oracle: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: true,
    canRename: false,
  },
  clickhouse: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: false,
    canRename: true,
  },
  // Db2 authenticates against the operating system or an external directory.
  // There is no CREATE USER; an account is made outside the database and then
  // granted privileges inside it. Roles are the part Db2 does own.
  db2: {
    supported: true,
    canCreateUser: false,
    canCreateRole: true,
    canDisable: false,
    canRename: false,
    reason:
      'Db2 authenticates against the operating system or a directory service, so there is ' +
      'no CREATE USER. Create the account on the server, then grant it privileges here.',
  },
};

const UNSUPPORTED: UserManagementSupport = {
  supported: false,
  canCreateUser: false,
  canCreateRole: false,
  canDisable: false,
  canRename: false,
  reason: 'This engine has no database accounts to manage.',
};

export function userManagementSupport(dialect: string): UserManagementSupport {
  const d = (dialect || '').toLowerCase();
  if (NO_ACCOUNTS.has(d)) return { ...UNSUPPORTED };
  const family = accessFamily(d);
  // Redshift maps to the postgres family for GRANT, but its account DDL differs
  // enough (GROUP rather than ROLE) that it gets its own entry below.
  return { ...(SUPPORT[family] ?? SUPPORT.postgres!) };
}

/** MySQL identifies an account by user and host together. */
function mysqlAccount(name: string, host: string | undefined): string {
  const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
  return `${quote(name)}@${quote(host?.trim() || '%')}`;
}

function ident(name: string, dialect: string): string {
  return quoteSqlIdentifier(name, dialect);
}

/**
 * Build the DDL for one account change.
 *
 * Returns `{ error }` rather than approximate SQL when the engine cannot
 * express the request — running a statement that is nearly right against an
 * account is worse than being told it is not possible.
 */
export function buildUserSql(
  request: UserRequest,
  dialect: string
): GeneratedUserSql | { error: string } {
  const name = request.name.trim();
  if (!name) return { error: 'Enter a name for the account.' };

  const support = userManagementSupport(dialect);
  if (!support.supported) return { error: support.reason ?? 'Not supported on this engine.' };

  const isUser = request.principalType === 'user';
  if (isUser && !support.canCreateUser && request.action === 'create') {
    return { error: support.reason ?? 'This engine cannot create users in SQL.' };
  }

  const family = accessFamily(dialect);
  const warnings: PermissionWarning[] = [];
  const statements: GeneratedStatement[] = [];

  const add = (sql: string, explanation: string, risk: PermissionRisk = 'elevated') =>
    statements.push({ sql, explanation, risk });

  const q = (v: string) => ident(v, dialect);
  const host = (request.options?.host as string | undefined) ?? request.host;
  const account = family === 'mysql' ? mysqlAccount(name, host) : q(name);
  const noun = isUser ? 'user' : 'role';

  // One rendering of the password for every statement below. Without a real
  // one the placeholder is emitted in the quoting the engine expects, so the
  // statement still parses once the user substitutes their own.
  let passwordError: string | undefined;
  const pw = ((): string => {
    if (request.password === undefined || request.password === '') {
      return family === 'oracle' ? `"${PASSWORD_PLACEHOLDER}"` : `'${PASSWORD_PLACEHOLDER}'`;
    }
    const rendered = renderPasswordLiteral(request.password, dialect);
    if ('error' in rendered) {
      passwordError = rendered.error;
      return '';
    }
    return rendered.sql;
  })();
  const usingRealPassword = request.password !== undefined && request.password !== '';

  if (request.action === 'create') {
    buildCreate();
  } else if (request.action === 'drop') {
    buildDrop();
  } else {
    const failed = buildAlter();
    if (failed) return { error: failed };
  }

  if (passwordError) return { error: passwordError };

  if (statements.length === 0) {
    return { error: `Nothing to do for this ${noun} on ${dialect}.` };
  }

  if (statements.some((st) => st.sql.includes(PASSWORD_PLACEHOLDER))) {
    warnings.push({
      level: 'danger',
      message:
        `Replace ${PASSWORD_PLACEHOLDER} with a real password before running this. Fox Schema ` +
        'never handles the password: it is not stored, sent anywhere, or kept in history.',
    });
  } else if (usingRealPassword) {
    warnings.push({
      level: 'danger',
      message:
        'This SQL contains the password in clear text. Fox Schema does not store it or send it ' +
        'anywhere, but your clipboard, terminal history and any server log will keep it — clear ' +
        'them afterwards.',
    });
  }

  return {
    statements,
    warnings,
    risk: statements.some((s) => s.risk === 'critical')
      ? 'critical'
      : statements.some((s) => s.risk === 'administrative')
        ? 'administrative'
        : 'elevated',
  };

  /** Option values, read only where the dialect actually offers the option. */
  function opt(key: UserOptionKey): string | number | boolean | undefined {
    const offered = createUserOptions(dialect, request.principalType).some((o) => o.key === key);
    return offered ? request.options?.[key] : undefined;
  }

  /** A trimmed text option, or undefined when blank. */
  function optText(key: UserOptionKey): string | undefined {
    const raw = opt(key);
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text.length > 0 ? text : undefined;
  }

  function buildCreate(): void {
    if (!isUser) {
      // Redshift calls it a GROUP and has no ROLE.
      if (dialect.toLowerCase() === 'redshift') {
        add(`CREATE GROUP ${q(name)};`, `Creates the group ${name}, which holds privileges.`);
        return;
      }
      add(
        `CREATE ROLE ${account};`,
        `Creates the role ${name}. A role holds privileges; grant it to users afterwards.`
      );
      return;
    }

    switch (family) {
      case 'mysql':
        {
          const tail: string[] = [];
          if (opt('mustChangePassword') === true) tail.push('PASSWORD EXPIRE');
          if (opt('startLocked') === true) tail.push('ACCOUNT LOCK');
          add(
            `CREATE USER ${account} IDENTIFIED BY ${pw}${tail.length ? ` ${tail.join(' ')}` : ''};`,
            `Creates ${name}, able to connect from ${host?.trim() || '%'}.`
          );
        }
        break;
      case 'sqlserver':
        // A login authenticates to the server; a user maps it into this
        // database. One without the other cannot connect and use data.
        {
          const clauses: string[] = [`PASSWORD = ${pw}`];
          if (opt('mustChangePassword') === true) {
            // MUST_CHANGE is rejected (Msg 15128) unless both policy checks are
            // on, so they travel with it rather than being left to the user.
            clauses[0] = `PASSWORD = ${pw} MUST_CHANGE`;
            clauses.push('CHECK_EXPIRATION = ON', 'CHECK_POLICY = ON');
          }
          const defaultDb = optText('defaultDatabase');
          if (defaultDb) clauses.push(`DEFAULT_DATABASE = ${q(defaultDb)}`);
          add(
            `CREATE LOGIN ${q(name)} WITH ${clauses.join(', ')};`,
            `Creates the server login ${name}. Run this against the master database.`
          );
          if (opt('startLocked') === true) {
            add(
              `ALTER LOGIN ${q(name)} DISABLE;`,
              `Leaves ${name} unable to connect until it is enabled. Run against master.`
            );
          }
        }
        add(
          `CREATE USER ${q(name)} FOR LOGIN ${q(name)};`,
          `Maps the login into this database as ${name}. Run this against the database itself.`
        );
        warnings.push({
          level: 'info',
          message:
            'SQL Server needs both: the login belongs to the server (master) and the user to ' +
            'this database. Run them against the right database each.',
        });
        break;
      case 'oracle':
        {
          const tablespace = optText('defaultTablespace');
          const tail: string[] = [];
          if (tablespace) {
            tail.push(`DEFAULT TABLESPACE ${q(tablespace)}`);
            // Without a quota the account owns a tablespace it cannot write to,
            // and the first insert fails with ORA-01950.
            tail.push(`QUOTA UNLIMITED ON ${q(tablespace)}`);
          }
          if (opt('mustChangePassword') === true) tail.push('PASSWORD EXPIRE');
          if (opt('startLocked') === true) tail.push('ACCOUNT LOCK');
          add(
            `CREATE USER ${q(name)} IDENTIFIED BY ${pw}${tail.length ? ` ${tail.join(' ')}` : ''};`,
            `Creates ${name}.`
          );
          add(
            `GRANT CREATE SESSION TO ${q(name)};`,
            'Without CREATE SESSION the account exists but cannot log in.'
          );
        }
        break;
      case 'clickhouse':
        add(
          `CREATE USER ${q(name)} IDENTIFIED WITH sha256_password BY ${pw};`,
          `Creates ${name}.`
        );
        break;
      default:
        if (dialect.toLowerCase() === 'redshift') {
          add(
            `CREATE USER ${q(name)} PASSWORD ${pw};`,
            `Creates ${name}.`
          );
          break;
        }
        // Postgres and the engines that share its wire protocol. LOGIN is what
        // separates a user from a role here — the two are one object type.
        {
          const attrs: string[] = ['LOGIN'];
          if (opt('superuser') === true) attrs.push('SUPERUSER');
          if (opt('createDb') === true) attrs.push('CREATEDB');
          if (opt('createRole') === true) attrs.push('CREATEROLE');
          const limit = opt('connectionLimit');
          if (limit !== undefined && limit !== '' && Number.isFinite(Number(limit))) {
            attrs.push(`CONNECTION LIMIT ${Number(limit)}`);
          }
          const until = optText('validUntil');
          add(
            `CREATE ROLE ${q(name)} WITH ${attrs.join(' ')} PASSWORD ${pw}` +
              `${until ? ` VALID UNTIL '${until.replace(/'/g, "''")}'` : ''};`,
            `Creates ${name} and allows it to connect. In Postgres a user is a role with LOGIN.`
          );
          if (opt('superuser') === true) {
            warnings.push({
              level: 'danger',
              message:
                `${name} would be a superuser: it bypasses every permission check, including ` +
                'anything granted or revoked here.',
            });
          }
        }
        break;
    }
  }

  function buildDrop(): void {
    const risk: PermissionRisk = 'administrative';
    if (family === 'oracle' && isUser) {
      // Oracle refuses to drop a user that owns anything, so the choice has to
      // be explicit rather than silently appended.
      add(
        `DROP USER ${q(name)}${request.cascade ? ' CASCADE' : ''};`,
        request.cascade
          ? `Drops ${name} and every object it owns. The objects are not recoverable.`
          : `Drops ${name}. Oracle refuses this while the account owns any object — use CASCADE to drop those too.`,
        request.cascade ? 'critical' : risk
      );
      return;
    }
    if (family === 'sqlserver' && isUser) {
      add(`DROP USER ${q(name)};`, `Removes ${name} from this database.`, risk);
      add(
        `DROP LOGIN ${q(name)};`,
        `Removes the server login ${name}. Run against master, and only if no other database uses it.`,
        risk
      );
      return;
    }
    if (!isUser && dialect.toLowerCase() === 'redshift') {
      add(`DROP GROUP ${q(name)};`, `Drops the group ${name}.`, risk);
      return;
    }
    const keyword = isUser ? 'USER' : 'ROLE';
    add(
      `DROP ${keyword} ${account};`,
      `Drops the ${noun} ${name}. Privileges granted to it are removed with it.`,
      risk
    );
    if (family === 'postgres') {
      warnings.push({
        level: 'caution',
        message:
          `Postgres refuses to drop ${name} while it owns objects or holds privileges. ` +
          `Reassign or drop those first: REASSIGN OWNED BY ${q(name)} TO ..., then DROP OWNED BY ${q(name)}.`,
      });
    }
  }

  /** Returns an error message, or undefined on success. */
  function buildAlter(): string | undefined {
    const change = request.alteration ?? 'password';

    if (change === 'rename') {
      const next = request.newName?.trim();
      if (!next) return 'Enter the new name.';
      if (!support.canRename) {
        return `${dialect} cannot rename an account. Create the new one and drop the old.`;
      }
      if (family === 'mysql') {
        add(
          `RENAME USER ${account} TO ${mysqlAccount(next, request.host)};`,
          `Renames ${name} to ${next}. Privileges follow the account.`
        );
        return undefined;
      }
      const keyword = family === 'sqlserver' ? 'USER' : isUser ? 'USER' : 'ROLE';
      add(
        `ALTER ${keyword} ${q(name)} ${family === 'sqlserver' ? 'WITH NAME =' : 'RENAME TO'} ${q(next)};`,
        `Renames ${name} to ${next}. Privileges follow the account.`
      );
      return undefined;
    }

    if (change === 'password') {
      if (!isUser) return 'A role has no password.';
      switch (family) {
        case 'mysql':
          add(
            `ALTER USER ${account} IDENTIFIED BY ${pw};`,
            `Sets a new password for ${name}.`
          );
          return undefined;
        case 'sqlserver':
          add(
            `ALTER LOGIN ${q(name)} WITH PASSWORD = ${pw};`,
            `Sets a new password for the login ${name}. Run against master.`
          );
          return undefined;
        case 'oracle':
          add(
            `ALTER USER ${q(name)} IDENTIFIED BY ${pw};`,
            `Sets a new password for ${name}.`
          );
          return undefined;
        case 'clickhouse':
          add(
            `ALTER USER ${q(name)} IDENTIFIED WITH sha256_password BY ${pw};`,
            `Sets a new password for ${name}.`
          );
          return undefined;
        default:
          add(
            `ALTER ROLE ${q(name)} WITH PASSWORD ${pw};`,
            `Sets a new password for ${name}.`
          );
          return undefined;
      }
    }

    // disable / enable
    if (!support.canDisable) {
      return `${dialect} cannot disable an account. Drop it, or revoke its privileges instead.`;
    }
    const disabling = change === 'disable';
    switch (family) {
      case 'mysql':
        add(
          `ALTER USER ${account} ACCOUNT ${disabling ? 'LOCK' : 'UNLOCK'};`,
          disabling
            ? `Refuses new connections from ${name}. The account and its privileges stay.`
            : `Lets ${name} connect again.`
        );
        return undefined;
      case 'sqlserver':
        add(
          `ALTER LOGIN ${q(name)} ${disabling ? 'DISABLE' : 'ENABLE'};`,
          disabling
            ? `Refuses new connections from ${name}. Run against master.`
            : `Lets ${name} connect again. Run against master.`
        );
        return undefined;
      case 'oracle':
        add(
          `ALTER USER ${q(name)} ACCOUNT ${disabling ? 'LOCK' : 'UNLOCK'};`,
          disabling ? `Refuses new connections from ${name}.` : `Lets ${name} connect again.`
        );
        return undefined;
      default:
        add(
          `ALTER ROLE ${q(name)} ${disabling ? 'NOLOGIN' : 'LOGIN'};`,
          disabling
            ? `Refuses new connections from ${name}. Existing sessions continue until they end.`
            : `Lets ${name} connect again.`
        );
        return undefined;
    }
  }
}
