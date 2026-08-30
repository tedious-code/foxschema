/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * User Management — list accounts from the database, then generate Add / Edit /
 * Drop SQL to review and run yourself. Fox Schema never applies the SQL and
 * never asks for a real password (placeholders only).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandModeToggle } from '@/shared/components/CommandModeToggle';
import { PasswordInput } from '@/shared/components/PasswordInput';
import {
  Copy,
  Check,
  AlertTriangle,
  ShieldAlert,
  Info,
  UserCog,
  KeyRound,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Plus,
  Trash2,
  Pencil,
  Users,
} from 'lucide-react';
import {
  PASSWORD_PLACEHOLDER,
  buildUserSql,
  buildDb2OsUserInstructions,
  userManagementSupport,
  dialectSupportsDbAccess,
  privilegesForPrincipal,
  type DbPrincipal,
  type DbPrivilege,
  type PrincipalType,
  type UserAction,
  type UserAlteration,
  type UserRequest,
  generateDb2OsPassword,
  validateDb2OsPassword,
  DB2_OS_PASSWORD_LENGTH,
  type Db2RunMode,
  DB2_DOCKER_CONTAINER,
  DEFAULT_DB2_RUN_MODE,
  osAccountSteps,
} from '../lib/access';
import { EmptyState, Field, RISK_STYLE, Segmented, inputCls } from './controls';
import { Autocomplete } from '@/shared/components/Autocomplete';
import {
  generateSuggestedPassword,
  sqlNeedsPassword,
  sqlWithPasswordSubstitute,
} from '../lib/password-suggest';
import { useSyncStore } from '@/app/store/useSyncStore';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { fetchDbAccess } from '@/shared/api/schemaApi';
import type { AccessPrincipalDraft } from '../lib/access-draft';

type Mode = 'idle' | 'add' | 'edit' | 'drop' | 'list';

const ALTERATION_LABEL: Record<UserAlteration, string> = {
  password: 'Set password',
  rename: 'Rename',
  disable: 'Disable login',
  enable: 'Enable login',
  expire: 'Expire password / account',
};

function parseMysqlAccount(raw: string): { name: string; host?: string } {
  const s = raw.trim().replace(/^'|'$/g, '');
  const at = s.lastIndexOf('@');
  if (at <= 0) return { name: s };
  return {
    name: s.slice(0, at).replace(/^'|'$/g, ''),
    host: s.slice(at + 1).replace(/^'|'$/g, '') || '%',
  };
}

function principalTypeOf(p: DbPrincipal): PrincipalType {
  return p.kind === 'user' ? 'user' : 'role';
}

/** Short, dialect-specific coaching shown after a connection is chosen. */
function dialectCoach(dialect: string): string | null {
  const d = dialect.toLowerCase();
  if (['sqlite', 'duckdb', 'mongodb', 'redis'].includes(d)) {
    return 'This engine has no SQL user catalog. Use OS / application permissions instead.';
  }
  if (d === 'postgres' || d === 'cockroachdb' || d === 'yugabytedb') {
    return 'PostgreSQL treats a user as a role with LOGIN. The list shows Name, Type, Roles, and whether login is allowed.';
  }
  if (d === 'redshift') {
    return 'Redshift uses USER and GROUP (not ROLE). Prefer groups for shared privileges, then grant the group to users.';
  }
  if (['mysql', 'mariadb', 'tidb'].includes(d)) {
    return 'Accounts are identified as name@host. The same username with a different host is a different account — Host is required when adding a user.';
  }
  if (d === 'sqlserver' || d === 'azuresql') {
    return 'SQL Server separates server LOGIN from database USER. Add user generates both statements — run the login against master, then the user against this database.';
  }
  if (d === 'oracle') {
    return 'Oracle needs CREATE SESSION to log in (included in Add user). Rename is not supported here; Drop can optionally CASCADE owned objects.';
  }
  if (d === 'db2') {
    return 'Db2 authenticates OS / LDAP logins — there is no CREATE USER. Add user (OS) creates the Linux account and GRANT CONNECT. Edit → Set password / Disable login / Enable login emit docker steps (chpasswd, passwd -l / -u). Grant access assigns table privileges.';
  }
  if (d === 'clickhouse') {
    return 'ClickHouse supports create / rename / drop here. Account lock (disable) is not available — drop or revoke privileges instead.';
  }
  return 'Review the user and role list, choose Add / Edit / Drop, then copy the SQL preview. Fox Schema never applies it for you.';
}

function availableAlterations(
  support: ReturnType<typeof userManagementSupport>,
  principalType: PrincipalType
): UserAlteration[] {
  const opts: UserAlteration[] = [];
  if (principalType === 'user') opts.push('password');
  if (support.canRename) opts.push('rename');
  if (support.canDisable && principalType === 'user') {
    opts.push('disable', 'enable');
  }
  if (support.canExpire && principalType === 'user') {
    opts.push('expire');
  }
  return opts;
}

function dropSafetyNotes(p: DbPrincipal, privileges: readonly DbPrivilege[]): string[] {
  const notes: string[] = [];
  const grants = privilegesForPrincipal(privileges, p.name);
  if (grants.length > 0) {
    const sample = grants
      .slice(0, 4)
      .map((g) => {
        const obj = [g.objectSchema, g.objectName].filter(Boolean).join('.') || g.objectType;
        return `${g.privilege} on ${obj}`;
      })
      .join('; ');
    notes.push(
      `This account has ${grants.length} recorded privilege${grants.length === 1 ? '' : 's'}` +
        (sample ? ` (e.g. ${sample}${grants.length > 4 ? '; …' : ''})` : '') +
        '. Dropping it removes those grants with the account.'
    );
  }
  if (p.memberOf.length > 0) {
    notes.push(`Member of: ${p.memberOf.join(', ')}. Role membership is removed with the account.`);
  }
  if (p.members.length > 0) {
    notes.push(
      `This role has ${p.members.length} member${p.members.length === 1 ? '' : 's'} (${p.members.slice(0, 5).join(', ')}${p.members.length > 5 ? ', …' : ''}). Dropping it does not drop those members.`
    );
  }
  return notes;
}

export const UserManagement: React.FC<{
  onGrantAccess?: (draft: AccessPrincipalDraft) => void;
}> = ({ onGrantAccess }) => {
  const connections = useSyncStore((s) => s.connections);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);

  const [connectionId, setConnectionId] = useState('');
  const conn = connections.find((c) => c.id === connectionId) || null;
  const dialect = conn?.dialect ?? '';

  const [principals, setPrincipals] = useState<DbPrincipal[]>([]);
  const [privileges, setPrivileges] = useState<DbPrivilege[]>([]);
  const [listHint, setListHint] = useState<string | null>(null);
  const [listWarning, setListWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'user' | 'role'>('all');

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');

  const [principalType, setPrincipalType] = useState<PrincipalType>('user');
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [alteration, setAlteration] = useState<UserAlteration>('password');
  const [validUntil, setValidUntil] = useState('');
  const [host, setHost] = useState('%');
  const [cascade, setCascade] = useState(false);
  const [osRole, setOsRole] = useState('');
  /**
   * The OS password for a Db2 account.
   *
   * Component state only — never stored, never sent to the server. It reaches
   * the generated chpasswd command and the clipboard, and nowhere else.
   */
  const [osPassword, setOsPassword] = useState('');
  /**
   * Where the OS-level commands are meant to run — Db2's whole procedure, and
   * the OS-account steps other engines offer for socket authentication.
   *
   * The compose file puts these databases in containers, but a real
   * installation is a server with a shell, where a `docker exec` prefix would
   * simply fail.
   */
  const [db2RunMode, setDb2RunMode] = useState<Db2RunMode>(DEFAULT_DB2_RUN_MODE);
  const osPasswordError = osPassword ? validateDb2OsPassword(osPassword) : null;
  const [copied, setCopied] = useState(false);
  const [copiedWithPassword, setCopiedWithPassword] = useState(false);

  const support = useMemo(() => userManagementSupport(dialect), [dialect]);
  const coach = useMemo(() => (dialect ? dialectCoach(dialect) : null), [dialect]);
  const listSupport = useMemo(
    () => (dialect ? dialectSupportsDbAccess(dialect) : null),
    [dialect]
  );
  const isMysqlFamily = ['mysql', 'mariadb', 'tidb'].includes(dialect.toLowerCase());
  const isOracle = dialect.toLowerCase() === 'oracle';
  const isSqlServer = ['sqlserver', 'azuresql'].includes(dialect.toLowerCase());
  const isDb2 = dialect.toLowerCase() === 'db2';

  const editOptions = useMemo(
    () => availableAlterations(support, principalType),
    [support, principalType]
  );

  useEffect(() => {
    if (mode === 'edit' && editOptions.length && !editOptions.includes(alteration)) {
      setAlteration(editOptions[0]!);
    }
  }, [mode, editOptions, alteration]);

  const selected = useMemo(
    () => principals.find((p) => p.name === selectedName) ?? null,
    [principals, selectedName]
  );

  const dropNotes = useMemo(() => {
    if (mode !== 'drop' || !selected) return [];
    return dropSafetyNotes(selected, privileges);
  }, [mode, selected, privileges]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return principals.filter((p) => {
      if (kindFilter === 'user' && p.kind !== 'user') return false;
      if (kindFilter === 'role' && p.kind === 'user') return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.memberOf.some((r) => r.toLowerCase().includes(q)) ||
        p.kind.toLowerCase().includes(q)
      );
    });
  }, [principals, filter, kindFilter]);

  const nameOptions = useMemo(
    () =>
      principals
        .filter((p) => (principalType === 'user' ? p.kind === 'user' : p.kind !== 'user'))
        .map((p) => ({ value: p.name, hint: p.kind })),
    [principals, principalType]
  );

  const roleOptions = useMemo(
    () => principals.filter((p) => p.kind !== 'user').map((p) => ({ value: p.name, hint: 'role' })),
    [principals]
  );

  const action: UserAction =
    mode === 'add' ? 'create' : mode === 'drop' ? 'drop' : mode === 'edit' ? 'alter' : 'create';

  const request: UserRequest = useMemo(
    () => ({
      action,
      principalType,
      name,
      newName,
      alteration,
      validUntil: alteration === 'expire' ? validUntil : undefined,
      host: isMysqlFamily && principalType === 'user' ? host : undefined,
      cascade,
    }),
    [action, principalType, name, newName, alteration, validUntil, host, isMysqlFamily, cascade]
  );

  const generated = useMemo(() => {
    if (mode === 'idle' || !dialect) return null;
    // Listing is about every account, so it does not need a name typed.
    if (mode === 'list') {
      return buildDb2OsUserInstructions({
        name: '',
        action: 'list',
        database: conn?.database,
        runMode: db2RunMode,
      });
    }
    if (!name.trim()) return null;
    if (isDb2 && principalType === 'user') {
      if (mode === 'add') {
        return buildDb2OsUserInstructions({
          name,
          role: osRole,
          database: conn?.database,
          password: osPassword || undefined,
          runMode: db2RunMode,
        });
      }
      if (
        mode === 'edit' &&
        (alteration === 'password' || alteration === 'disable' || alteration === 'enable')
      ) {
        return buildDb2OsUserInstructions({
          name,
          database: conn?.database,
          action: alteration,
          password: alteration === 'password' ? osPassword || undefined : undefined,
          runMode: db2RunMode,
        });
      }
      if (mode === 'drop') {
        // Removing a Db2 account is an OS operation, like adding one. Routed
        // here rather than through buildUserSql so it honours the run-mode
        // toggle and this connection's database, as add and edit already do.
        return buildDb2OsUserInstructions({
          name,
          database: conn?.database,
          action: 'drop',
          runMode: db2RunMode,
        });
      }
    }
    return buildUserSql(request, dialect);
  }, [mode, dialect, name, request, isDb2, principalType, osRole, conn?.database, alteration, osPassword, db2RunMode]);

  const osAccount = useMemo(() => {
    if (isDb2 || !dialect || !name.trim()) return null;
    return osAccountSteps(dialect, {
      name,
      runMode: db2RunMode,
      database: conn?.database,
    });
  }, [isDb2, dialect, name, db2RunMode, conn?.database]);

  const sqlText =
    generated && !('error' in generated)
      ? generated.statements.map((s) => s.sql).join('\n\n')
      : '';

  const grantDraft = useMemo((): AccessPrincipalDraft | null => {
    if (!onGrantAccess || !connectionId) return null;
    if (mode === 'add' && name.trim() && generated && !('error' in generated)) {
      // MySQL-family accounts are name@host. Permission Builder / formatDbGrantee
      // need the host or GRANT targets `` `user` `` instead of 'user'@'%'.
      const principalName =
        isMysqlFamily && principalType === 'user'
          ? `${name.trim()}@${(host || '%').trim() || '%'}`
          : isDb2 && principalType === 'user'
            ? name.trim().toUpperCase()
            : name.trim();
      return { connectionId, principalName, principalType };
    }
    if (selected) {
      return {
        connectionId,
        principalName: selected.name,
        principalType: principalTypeOf(selected),
      };
    }
    return null;
  }, [
    onGrantAccess,
    connectionId,
    mode,
    name,
    host,
    isMysqlFamily,
    isDb2,
    generated,
    principalType,
    selected,
  ]);

  const readyForGrant = Boolean(grantDraft);

  /**
   * Which catalog read is the current one.
   *
   * A read takes as long as the engine takes, and Oracle's is slow. Pick a
   * different connection while one is in flight and its response used to arrive
   * afterwards and repaint the list — so the panel showed one database's
   * accounts under another database's name. On a screen whose buttons drop
   * users and grant privileges, acting on the wrong list is the worst thing
   * this component can do, so a superseded response is discarded.
   */
  const loadToken = useRef(0);

  const loadPrincipals = useCallback(async () => {
    if (!connectionId) return;
    if (listSupport && !listSupport.query) {
      setPrincipals([]);
      setPrivileges([]);
      setListHint(listSupport.hint || 'This engine has no user catalog to list.');
      setListWarning(null);
      setListError(null);
      return;
    }
    const token = ++loadToken.current;
    const superseded = () => loadToken.current !== token;
    setLoading(true);
    setListError(null);
    try {
      const res = await fetchDbAccess(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        { schema: conn?.schema || undefined }
      );
      if (superseded()) return;
      setPrincipals(res.principals ?? []);
      setPrivileges(res.privileges ?? []);
      setListHint(res.support?.hint || null);
      setListWarning(res.warning || null);
      if (selectedName && !(res.principals ?? []).some((p) => p.name === selectedName)) {
        setSelectedName(null);
        if (mode !== 'add') setMode('idle');
      }
    } catch (e: unknown) {
      if (superseded()) return;
      setPrincipals([]);
      setPrivileges([]);
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      // Only the newest read owns the spinner; an older one finishing must not
      // report the current one as done.
      if (!superseded()) setLoading(false);
    }
  }, [connectionId, listSupport, sessionPasswords, conn?.schema, selectedName, mode]);

  useEffect(() => {
    // Leaving a connection invalidates any read still in flight for it, so the
    // cleared list cannot be repainted by the connection just left.
    loadToken.current++;
    setPrincipals([]);
    setPrivileges([]);
    setSelectedName(null);
    setMode('idle');
    setOsPassword('');
    setListError(null);
    setListHint(null);
    setListWarning(null);
    setName('');
    setFilter('');
  }, [connectionId]);

  useEffect(() => {
    if (connectionId && listSupport?.query) {
      void loadPrincipals();
    }
  }, [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per connection

  const startAdd = (type: PrincipalType) => {
    setMode('add');
    setSelectedName(null);
    setPrincipalType(type);
    setName('');
    setNewName('');
    setHost('%');
    setCascade(false);
    setOsRole('');
    setOsPassword('');
    setAlteration('password');
  };

  const startDrop = (p: DbPrincipal) => {
    setMode('drop');
    setSelectedName(p.name);
    setPrincipalType(principalTypeOf(p));
    if (isMysqlFamily && p.kind === 'user') {
      const parsed = parseMysqlAccount(p.name);
      setName(parsed.name);
      setHost(parsed.host || '%');
    } else {
      setName(p.name);
    }
    setCascade(false);
  };

  const startEdit = (p: DbPrincipal) => {
    setMode('edit');
    setSelectedName(p.name);
    setPrincipalType(principalTypeOf(p));
    if (isMysqlFamily && p.kind === 'user') {
      const parsed = parseMysqlAccount(p.name);
      setName(parsed.name);
      setHost(parsed.host || '%');
    } else {
      setName(p.name);
    }
    setNewName('');
    setAlteration(p.kind === 'user' ? 'password' : 'rename');
  };

  const selectRow = (p: DbPrincipal) => {
    setSelectedName(p.name);
    if (mode === 'add') setMode('idle');
    else if (mode === 'drop') startDrop(p);
    else if (mode === 'edit') startEdit(p);
  };

  const copy = async () => {
    if (!sqlText) return;
    await navigator.clipboard.writeText(sqlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const copyWithGeneratedPassword = async () => {
    if (!sqlText || !sqlNeedsPassword(sqlText)) return;
    const password = generateSuggestedPassword();
    await navigator.clipboard.writeText(sqlWithPasswordSubstitute(sqlText, password));
    setCopiedWithPassword(true);
    setTimeout(() => setCopiedWithPassword(false), 2500);
  };

  const showPasswordCopy = Boolean(sqlText && sqlNeedsPassword(sqlText));

  const goGrantAccess = () => {
    if (!grantDraft || !onGrantAccess) return;
    onGrantAccess(grantDraft);
  };

  const noun = principalType === 'user' ? 'user' : 'role';

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="user-management">
      {/* How this works */}
      <div
        data-testid="user-howto"
        className="shrink-0 border-b border-slate-800 bg-slate-950/80 px-5 py-3"
      >
        <div className="flex items-start gap-2">
          <Users className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-100">How User Management works</p>
            <ol className="mt-1 grid gap-0.5 text-[11px] text-slate-400 sm:grid-cols-2 lg:grid-cols-5">
              <li>
                <span className="font-semibold text-slate-300">1.</span> Choose a database
                connection
              </li>
              <li>
                <span className="font-semibold text-slate-300">2.</span> Review the user / role list
              </li>
              <li>
                <span className="font-semibold text-slate-300">3.</span> Add, edit, or drop one
                account
              </li>
              <li>
                <span className="font-semibold text-slate-300">4.</span> Check the SQL preview on the
                right
              </li>
              <li>
                <span className="font-semibold text-slate-300">5.</span> Copy SQL and run it yourself
                — Fox Schema never applies it
              </li>
            </ol>
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ── Left: connection + list + action form ─────────────────── */}
        <div className="w-[52%] min-w-[400px] border-r border-slate-800 p-4 flex flex-col gap-3 min-h-0 overflow-hidden">
          <div className="shrink-0 flex flex-col gap-3">
          <Field label="Database connection">
            <div className="flex gap-2">
              <select
                data-testid="user-connection"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className={`${inputCls} flex-1`}
              >
                <option value="">Select a connection…</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.dialect}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="user-refresh"
                onClick={() => void loadPrincipals()}
                disabled={!connectionId || loading || listSupport?.query === false}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 text-[11px] font-semibold text-slate-200 disabled:opacity-40"
                title="Reload users and roles from the database"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </Field>

          {!connectionId && (
            <EmptyState
              title="Select a database"
              body="Pick a saved connection above. Fox Schema will list users and roles from that database so you can add, edit, or drop them with generated SQL."
            />
          )}

          {dialect && !support.supported && (
            <div
              data-testid="user-unsupported"
              className="rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2.5 text-[11px] text-slate-400"
            >
              {support.reason}
            </div>
          )}

          {listError && (
            <div
              data-testid="user-list-error"
              className="rounded-md border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-200"
            >
              {listError}
            </div>
          )}

          {listWarning && (
            <div className="rounded-md border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-200">
              {listWarning}
            </div>
          )}

          {coach && support.supported && (
            <div
              data-testid="user-dialect-coach"
              className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100"
            >
              <span className="font-bold text-sky-50">{dialect}</span>
              <span className="text-sky-200/90"> — {coach}</span>
            </div>
          )}
          </div>

          {connectionId && support.supported && (
            <>
              <div className="shrink-0 flex flex-wrap items-center gap-2">
                {(support.canCreateUser || isDb2) && (
                <button
                  type="button"
                  data-testid="user-add-user"
                  onClick={() => startAdd('user')}
                  title={
                    isDb2
                      ? 'Generate OS-user + GRANT CONNECT steps for the foxschema-db2 container'
                      : 'Generate CREATE USER SQL'
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[11px] font-bold text-emerald-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isDb2 ? 'Add user (OS)' : 'Add user'}
                </button>
                )}
                {isDb2 && (
                  <button
                    type="button"
                    data-testid="user-list-commands"
                    onClick={() => {
                      setMode('list');
                      setSelectedName(null);
                      setOsPassword('');
                    }}
                    title="Generate commands to list OS logins and Db2 authorization IDs"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-600 bg-slate-800 text-[11px] font-bold text-slate-100 hover:bg-slate-700"
                  >
                    Check users
                  </button>
                )}
                {support.canCreateRole && (
                <button
                  type="button"
                  data-testid="user-add-role"
                  onClick={() => startAdd('role')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-sky-500/40 bg-sky-500/10 text-[11px] font-bold text-sky-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add role
                </button>
                )}
                {!support.canCreateUser && !isDb2 && support.reason && (
                  <p data-testid="user-create-blocked" className="text-[11px] text-amber-200/90">
                    {support.reason}
                  </p>
                )}
                <button
                  type="button"
                  data-testid="user-edit-selected"
                  onClick={() => selected && startEdit(selected)}
                  disabled={!selected || editOptions.length === 0}
                  title={
                    editOptions.length === 0
                      ? 'No edit actions are available on this engine for the selected account'
                      : 'Generate ALTER SQL for the selected account'
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-600 text-[11px] font-bold text-slate-200 disabled:opacity-40"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  data-testid="user-drop-selected"
                  onClick={() => selected && startDrop(selected)}
                  disabled={!selected}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-500/40 bg-rose-500/10 text-[11px] font-bold text-rose-100 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Drop
                </button>
                {onGrantAccess && (
                  <button
                    type="button"
                    data-testid="user-grant-selected"
                    onClick={goGrantAccess}
                    disabled={!readyForGrant}
                    title="Open Permission Builder for the selected (or newly named) account"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-violet-500/40 bg-violet-500/10 text-[11px] font-bold text-violet-100 disabled:opacity-40"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Grant access
                  </button>
                )}
              </div>

              <div className="shrink-0 flex flex-wrap gap-2 items-center">
                <input
                  data-testid="user-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name or role…"
                  className={`${inputCls} flex-1 min-w-[10rem]`}
                />
                <Segmented
                  testId="user-kind-filter"
                  value={kindFilter}
                  onChange={(v) => setKindFilter(v as 'all' | 'user' | 'role')}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'user', label: 'Users' },
                    { value: 'role', label: 'Roles' },
                  ]}
                />
              </div>

              <div
                data-testid="user-list"
                className="flex-1 min-h-[10rem] overflow-y-auto overscroll-contain rounded-md border border-slate-800"
              >
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-2.5 py-1.5 font-bold">Name</th>
                      <th className="px-2.5 py-1.5 font-bold">Type</th>
                      <th className="px-2.5 py-1.5 font-bold">Roles</th>
                      <th className="px-2.5 py-1.5 font-bold">Login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && principals.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2.5 py-6 text-center text-slate-500">
                          Reading users and roles…
                        </td>
                      </tr>
                    )}
                    {!loading && filtered.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-2.5 py-6 text-center text-slate-500"
                          data-testid="user-list-empty"
                        >
                          {listSupport && !listSupport.query
                            ? listSupport.hint || 'No user catalog on this engine.'
                            : listHint ||
                              (isDb2
                                ? 'No users with CONNECT (or roles) yet. Use Add user (OS), run the commands, then reload.'
                                : 'No users or roles found. Use Add user / Add role to generate CREATE SQL.')}
                        </td>
                      </tr>
                    )}
                    {filtered.map((p) => {
                      const active = selectedName === p.name;
                      return (
                        <tr
                          key={`${p.kind}:${p.name}`}
                          data-testid={`user-row-${p.name}`}
                          onClick={() => selectRow(p)}
                          onDoubleClick={() => startEdit(p)}
                          title="Click to select · Double-click to edit"
                          className={`cursor-pointer border-b border-slate-800/80 ${
                            active
                              ? 'bg-sky-500/15 text-slate-100'
                              : 'text-slate-300 hover:bg-slate-900/80'
                          }`}
                        >
                          <td className="px-2.5 py-1.5 font-mono text-[12px]">{p.name}</td>
                          <td className="px-2.5 py-1.5 capitalize">{p.kind}</td>
                          <td className="px-2.5 py-1.5 text-slate-400 truncate max-w-[10rem]" title={p.memberOf.join(', ')}>
                            {p.memberOf.length ? p.memberOf.join(', ') : '—'}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {p.canLogin === true ? 'Yes' : p.canLogin === false ? 'No' : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {mode !== 'idle' && (
                <div
                  data-testid="user-action-form"
                  className="shrink-0 max-h-[40%] overflow-y-auto rounded-md border border-slate-700 bg-slate-900/40 p-3 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      {mode === 'add' && `Add ${noun}`}
                      {mode === 'edit' && `Edit ${selected?.name || noun}`}
                      {mode === 'drop' && `Drop ${selected?.name || noun}`}
                    </p>
                    <button
                      type="button"
                      data-testid="user-cancel-action"
                      onClick={() => {
                        setMode('idle');
                        setOsPassword('');
                        setName('');
                      }}
                      className="text-[11px] text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>

                  {mode === 'add' && (
                    <Field label="What are you adding?">
                      <Segmented
                        testId="user-type"
                        value={principalType}
                        onChange={(v) => setPrincipalType(v as PrincipalType)}
                        options={[
                          ...(support.canCreateUser || isDb2
                            ? [{ value: 'user', label: 'User (logs in)' }]
                            : []),
                          ...(support.canCreateRole
                            ? [{ value: 'role', label: 'Role (holds privileges)' }]
                            : []),
                        ]}
                      />
                    </Field>
                  )}

                  <Field
                    label={mode === 'add' ? `New ${noun} name` : `${noun} name`}
                    hint={
                      mode === 'drop'
                        ? 'Drop removes the account. Privileges granted to it go with it.'
                        : undefined
                    }
                  >
                    {mode === 'add' ? (
                      <Autocomplete
                        data-testid="user-name"
                        theme="slate"
                        value={name}
                        onChange={setName}
                        options={nameOptions}
                        placeholder={principalType === 'user' ? 'report_user' : 'reporting_reader'}
                      />
                    ) : (
                      <input
                        data-testid="user-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={mode === 'drop' || mode === 'edit'}
                        placeholder={principalType === 'user' ? 'report_user' : 'reporting_reader'}
                        className={inputCls}
                      />
                    )}
                  </Field>

                  {isDb2 &&
                    principalType === 'user' &&
                    (mode === 'add' || (mode === 'edit' && alteration === 'password')) && (
                      <Field
                        label="OS password"
                        hint={
                          osPasswordError ??
                          (osPassword
                            ? 'Written into the chpasswd command below in clear text. Fox Schema does not store it or send it anywhere.'
                            : `Leave empty to get a <password> placeholder to fill in yourself. Generated passwords are ${DB2_OS_PASSWORD_LENGTH} characters and avoid anything the shell would treat as syntax.`)
                        }
                      >
                        <div className="flex items-center gap-2">
                          <PasswordInput
                            data-testid="user-os-password"
                            value={osPassword}
                            onChange={(e) => setOsPassword(e.target.value)}
                            placeholder="<password>"
                            autoComplete="new-password"
                            className={inputCls}
                          />
                          <button
                            type="button"
                            data-testid="user-os-password-generate"
                            onClick={() => setOsPassword(generateDb2OsPassword())}
                            title={`Generate a ${DB2_OS_PASSWORD_LENGTH}-character password valid for a Linux account`}
                            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-600 bg-slate-800 text-[11px] font-bold text-slate-100 hover:bg-slate-700"
                          >
                            Generate
                          </button>
                        </div>
                      </Field>
                    )}

                  {isDb2 && mode === 'add' && principalType === 'user' && (
                    <Field
                      label="Assign role (optional)"
                      hint="GRANT ROLE after CONNECT. Create the role first with Add role if it is not in the list."
                    >
                      <Autocomplete
                        data-testid="user-os-role"
                        theme="slate"
                        value={osRole}
                        onChange={setOsRole}
                        options={roleOptions}
                        placeholder="ANALYSTS"
                      />
                    </Field>
                  )}

                  {isMysqlFamily && principalType === 'user' && (mode === 'add' || mode === 'drop' || mode === 'edit') && (
                    <Field
                      label="Host"
                      hint="MySQL/MariaDB accounts are name@host. Different host = different account. Use % for any host."
                    >
                      <input
                        data-testid="user-host"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        disabled={mode === 'drop' || mode === 'edit'}
                        placeholder="%"
                        className={inputCls}
                      />
                    </Field>
                  )}

                  {mode === 'edit' && editOptions.length > 0 && (
                    <Field label="Change">
                      <Segmented
                        testId="user-alteration"
                        value={alteration}
                        onChange={(v) => setAlteration(v as UserAlteration)}
                        options={editOptions.map((a) => ({
                          value: a,
                          label: ALTERATION_LABEL[a],
                        }))}
                      />
                    </Field>
                  )}

                  {mode === 'edit' && editOptions.length === 0 && (
                    <p className="text-[11px] text-amber-200">
                      This engine has no edit actions for this account type. Use Drop, or manage it
                      outside Fox Schema.
                    </p>
                  )}

                  {mode === 'edit' && alteration === 'rename' && support.canRename && (
                    <Field label="New name">
                      <input
                        data-testid="user-new-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                  )}

                  {mode === 'edit' && alteration === 'expire' && support.canExpire && (
                    <Field
                      label="Expiry"
                      hint={
                        isMysqlFamily
                          ? 'Days until password must change (leave empty for next-login expiry).'
                          : 'ISO timestamp for VALID UNTIL, or leave empty for infinity (Postgres).'
                      }
                    >
                      <input
                        data-testid="user-valid-until"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        placeholder={isMysqlFamily ? '90' : '2027-12-31'}
                        className={inputCls}
                      />
                    </Field>
                  )}

                  {mode === 'drop' && isOracle && principalType === 'user' && (
                    <label className="flex items-start gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        data-testid="user-cascade"
                        checked={cascade}
                        onChange={(e) => setCascade(e.target.checked)}
                        className="mt-0.5 accent-rose-500"
                      />
                      <span>
                        Drop everything this account owns (CASCADE)
                        <span className="block text-slate-500">
                          Oracle refuses DROP while the account owns objects. Not recoverable.
                        </span>
                      </span>
                    </label>
                  )}

                  {mode === 'drop' && dropNotes.length > 0 && (
                    <div
                      data-testid="user-drop-safety"
                      className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100"
                    >
                      {dropNotes.map((note, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {((mode === 'add' && principalType === 'user' && (support.canCreateUser || isDb2)) ||
                    (isDb2 && mode === 'edit' && alteration === 'password')) && (
                    <div className="flex items-start gap-2 rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-400">
                      <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        Password stays with you. Commands use{' '}
                        <code className="text-slate-300">{PASSWORD_PLACEHOLDER}</code> — replace it
                        before you run them.
                      </span>
                    </div>
                  )}

                  {isDb2 && (mode === 'add' || mode === 'edit') && principalType === 'user' && (
                    <div
                      data-testid="user-db2-hint"
                      className="rounded-md border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-200"
                    >
                      {mode === 'add'
                        ? 'Copy the docker commands into a terminal (replace <password>), then reload this list. Grant access next assigns table privileges to the uppercase authorization ID.'
                        : alteration === 'password'
                          ? 'Db2 stores no SQL password. chpasswd changes the Linux password used to connect.'
                          : alteration === 'disable'
                            ? 'Disable locks the Linux account (passwd -l) and REVOKE CONNECT. Table GRANTs stay until you revoke them.'
                            : alteration === 'enable'
                              ? 'Enable unlocks the Linux account and GRANT CONNECT again.'
                              : 'CREATE ROLE is SQL. After the role exists, Add user (OS) can GRANT ROLE to the new login, or use Grant access.'}
                    </div>
                  )}

                  {isDb2 && mode === 'add' && principalType === 'role' && (
                    <div
                      data-testid="user-db2-hint"
                      className="rounded-md border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-200"
                    >
                      CREATE ROLE is SQL. After the role exists, Add user (OS) can GRANT ROLE to the
                      new login, or use Grant access.
                    </div>
                  )}

                  {isSqlServer && mode === 'add' && principalType === 'user' && (
                    <div
                      data-testid="user-sqlserver-hint"
                      className="rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-400"
                    >
                      SQL Server needs a login (run against master) and a database user (run against
                      this database). Both appear in the preview.
                    </div>
                  )}
                </div>
              )}

              {mode === 'idle' && selected && (
                <p className="shrink-0 text-[11px] text-slate-500">
                  Selected <code className="text-slate-300">{selected.name}</code> (
                  {selected.kind}
                  {selected.memberOf.length
                    ? ` · roles: ${selected.memberOf.join(', ')}`
                    : ''}
                  ). Double-click to edit, or use Edit / Drop / Grant access.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Right: SQL preview (always) ─────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-slate-100">SQL Preview</h2>
            {generated && !('error' in generated) && (
              <span
                data-testid="user-risk"
                className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${RISK_STYLE[generated.risk]}`}
              >
                {generated.risk}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
              {showPasswordCopy && (
                <button
                  type="button"
                  data-testid="user-copy-with-password"
                  onClick={() => void copyWithGeneratedPassword()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[11px] font-bold text-emerald-100"
                  title="Copies SQL with a one-time generated password. Fox Schema does not store it."
                >
                  {copiedWithPassword ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <KeyRound className="w-3.5 h-3.5" />
                  )}
                  {copiedWithPassword ? 'Copied with password' : 'Copy with generated password'}
                </button>
              )}
              <button
                type="button"
                data-testid="user-copy"
                onClick={copy}
                disabled={!sqlText}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-[11px] font-bold text-sky-100 disabled:opacity-40"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy SQL'}
              </button>
              {onGrantAccess && (
                <button
                  type="button"
                  data-testid="user-grant-next"
                  onClick={goGrantAccess}
                  disabled={!readyForGrant}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-[11px] font-bold text-violet-100 disabled:opacity-40"
                  title={
                    readyForGrant
                      ? `Open Permission Builder for ${grantDraft?.principalName ?? 'this account'}`
                      : 'Select a listed account, or finish Add user / Add role first'
                  }
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Grant access next
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {mode === 'idle' && (
            <EmptyState
              title="SQL appears here"
              body="Select a user or role and click Edit or Drop, or click Add user / Add role. Fox Schema only generates SQL — you review, copy, and run it on the database."
            />
          )}

          {mode !== 'idle' && !generated && (
            <EmptyState
              title={`Name the ${noun}`}
              body="Enter a name in the form on the left. The SQL preview updates as you type."
            />
          )}

          {generated && 'error' in generated && (
            <div
              data-testid="user-error"
              className="rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2.5 text-[11px] text-amber-200"
            >
              {generated.error}
            </div>
          )}

          {generated && !('error' in generated) && (
            <>
              <div
                data-testid="user-sql"
                className="rounded-md border border-slate-800 bg-slate-950/70 divide-y divide-slate-800/70"
              >
                {generated.statements.map((s, i) => (
                  <div key={i} className="p-3">
                    <pre className="text-[12px] font-mono text-slate-100 whitespace-pre-wrap break-words">
                      {s.sql}
                    </pre>
                    <p className="mt-1.5 text-[11px] text-slate-500">{s.explanation}</p>
                  </div>
                ))}
              </div>

              {/* Db2's steps are already shell commands, and they are only
                  runnable as written if Db2 is in a container. This picks how
                  to reach root and the instance owner instead. */}
              {(isDb2 || osAccount?.applicable) && (
                <label className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                  Where do these run?
                  <select
                    data-testid="user-db2-run-mode"
                    value={db2RunMode}
                    onChange={(e) => setDb2RunMode(e.target.value as Db2RunMode)}
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-[11px] font-normal text-slate-100"
                  >
                    <option value="server">Db2 on a server — Ubuntu, Debian, RHEL (sudo)</option>
                    <option value="docker">Db2 in a container (docker exec)</option>
                  </select>
                  <span className="font-normal text-slate-500">
                    {db2RunMode === 'docker'
                      ? `Prefixes each step with docker exec against ${DB2_DOCKER_CONTAINER}.`
                      : 'Plain OS commands to run on the database server itself. No Docker needed.'}
                  </span>
                </label>
              )}

              {/* Whether an OS account does anything for this engine. Shown
                  for Add user only: it pairs with creating one, and the answer
                  is often "nothing", which is worth saying. */}
              {!isDb2 && mode === 'add' && principalType === 'user' && osAccount && (
                <div className="flex flex-col gap-1.5 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
                  <p className="text-[11px] font-bold text-slate-400">
                    Operating-system account
                    {!osAccount.applicable && (
                      <span className="ml-1.5 font-normal text-slate-500">not needed here</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">{osAccount.rationale}</p>
                  {osAccount.statements.map((st, i) => (
                    <div key={i} data-testid={`user-os-step-${i}`}>
                      <pre className="whitespace-pre-wrap break-all text-[11px] font-mono text-slate-200">
                        {st.sql}
                      </pre>
                      <p className="text-[11px] text-slate-500">{st.explanation}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* The Db2 path already emits shell commands; a second one would
                  be noise. Everything else is SQL, and this is how to run it. */}
              {!isDb2 && conn && (
                <CommandModeToggle
                  data-testid="user-command-mode"
                  sql={generated.statements.map((s) => s.sql).join('\n')}
                  dialect={dialect}
                  target={{
                    host: conn.host,
                    port: conn.port,
                    database: conn.database,
                    username: conn.username,
                    schema: conn.schema,
                  }}
                />
              )}

              {generated.warnings.length > 0 && (
                <div className="flex flex-col gap-1.5" data-testid="user-warnings">
                  {generated.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] ${
                        w.level === 'danger'
                          ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                          : w.level === 'caution'
                            ? 'border-amber-500/40 bg-amber-950/25 text-amber-200'
                            : 'border-slate-700 bg-slate-900/50 text-slate-400'
                      }`}
                    >
                      {w.level === 'danger' ? (
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : w.level === 'caution' ? (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <UserCog className="w-3.5 h-3.5" />
                {isDb2 && principalType === 'user' && (mode === 'add' || mode === 'edit')
                  ? 'Preview only. Copy and run the docker commands in a terminal — Fox Schema does not create, lock, or change OS users for you.'
                  : 'Preview only. Copy and run this SQL in your DBA tool or the SQL Editor — Fox Schema does not create, change, or drop accounts for you.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
