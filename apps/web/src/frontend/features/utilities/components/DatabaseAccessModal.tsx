/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Utilities / Access control → Database Access: users, roles/groups, and
 * GRANT / REVOKE on the connected database.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  RefreshCw,
  Shield,
  X,
} from 'lucide-react';
import {
  buildGrantRevokeSql,
  dialectSupportsDbAccess,
  groupDbPrincipals,
  privilegesForPrincipal,
  DB_OBJECT_PRIVILEGES,
  type DbPrincipal,
  type DbPrivilege,
  type DbPrivilegeObjectType,
} from '@foxschema/sql';
import { PERMISSION_META } from '@foxschema/shared';
import { fetchDbAccess } from '@/shared/api/schemaApi';
import { executeSql } from '@/shared/api/sqlApi';
import { useSyncStore } from '@/app/store/useSyncStore';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { useAuthStore } from '@/app/store/authStore';
import { PROVIDER_SETTINGS, connectionNeedsSecret } from '@/shared/lib/provider-settings';

interface Props {
  open: boolean;
  onClose?: () => void;
  /** Embed in Access control (no modal shell). */
  embedded?: boolean;
  /** Jump to Access control → App roles (Grant privileges). */
  onOpenAppRoles?: () => void;
}

type ConfirmAction = {
  title: string;
  sql: string;
  kind: 'grant' | 'revoke';
};

const LS_CONN = 'foxschema-utilities-db-access-connection';
const GRANT_PRIV_META = PERMISSION_META.find((m) => m.id === 'editor.grant');

export const DatabaseAccessModal: React.FC<Props> = ({
  open,
  onClose,
  embedded = false,
  onOpenAppRoles,
}) => {
  const connections = useSyncStore((s) => s.connections);
  const ensureConnectionSelected = useSqlEditorStore((s) => s.ensureConnectionSelected);
  const submitSessionPassword = useSqlEditorStore((s) => s.submitSessionPassword);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const canGrant = useAuthStore((s) => s.can('editor.grant'));

  const [connectionId, setConnectionId] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [principals, setPrincipals] = useState<DbPrincipal[]>([]);
  const [privileges, setPrivileges] = useState<DbPrivilege[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['role', 'user']));
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  const [grantPrivilege, setGrantPrivilege] = useState<string>('SELECT');
  const [grantObjectType, setGrantObjectType] = useState<DbPrivilegeObjectType>('TABLE');
  const [grantSchema, setGrantSchema] = useState('');
  const [grantName, setGrantName] = useState('');
  const [grantWithOption, setGrantWithOption] = useState(false);

  const conn = connections.find((c) => c.id === connectionId);
  // File dialects carry no password; asking for one blocked the utility outright.
  const needsPassword = Boolean(
    conn && !conn.hasPassword && connectionNeedsSecret(conn.dialect, conn.authMethod) && !sessionPasswords[connectionId]
  );
  const dialect = conn?.dialect ?? '';
  const support = dialect ? dialectSupportsDbAccess(dialect) : null;

  useEffect(() => {
    if (!open || embedded) return;
    const saved = localStorage.getItem(LS_CONN) ?? '';
    if (saved && connections.some((c) => c.id === saved)) setConnectionId(saved);
  }, [open, embedded, connections]);

  const load = useCallback(async () => {
    if (!connectionId || needsPassword) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const data = await fetchDbAccess(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        { schema: conn?.schema }
      );
      setPrincipals(data.principals ?? []);
      setPrivileges(data.privileges ?? []);
      setWarning(data.warning ?? null);
      setHint(data.support?.hint ?? null);
      if (data.principals?.[0] && !selectedName) {
        setSelectedName(data.principals[0].name);
      }
    } catch (err: unknown) {
      setPrincipals([]);
      setPrivileges([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, needsPassword, sessionPasswords, conn?.schema, selectedName]);

  useEffect(() => {
    if (!open || !connectionId || needsPassword) return;
    void load();
    // Load when the credential is chosen; selectedName is intentionally omitted
    // so picking a user does not refetch the catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, needsPassword]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? principals.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.memberOf.some((m) => m.toLowerCase().includes(q)) ||
            p.members.some((m) => m.toLowerCase().includes(q))
        )
      : principals;
    return groupDbPrincipals(filtered);
  }, [principals, filter]);

  const selected = principals.find((p) => p.name === selectedName) ?? null;
  const allSelectedPrivs = selected ? privilegesForPrincipal(privileges, selected.name) : [];
  // Belonging to a role and holding a privilege are different things, and the
  // catalog returns both in one list. Splitting them here is what keeps the two
  // sections below from reading as one.
  const selectedPrivs = allSelectedPrivs.filter((p) => p.objectType !== 'ROLE');
  const selectedMemberships = allSelectedPrivs.filter((p) => p.objectType === 'ROLE');

  const grantPreview = useMemo(() => {
    if (!dialect || !selected) return null;
    const built = buildGrantRevokeSql({
      dialect,
      action: 'grant',
      privilege: grantObjectType === 'ROLE' ? grantName || grantPrivilege : grantPrivilege,
      objectType: grantObjectType,
      objectSchema: grantSchema || conn?.schema || null,
      objectName: grantName || null,
      grantee: selected.name,
      granteeKind: selected.kind === 'group' ? 'group' : selected.kind === 'role' ? 'role' : 'user',
      withGrantOption: grantWithOption,
    });
    return built;
  }, [
    dialect,
    selected,
    grantPrivilege,
    grantObjectType,
    grantSchema,
    grantName,
    grantWithOption,
    conn?.schema,
  ]);

  const runSql = async (sql: string, kind: 'grant' | 'revoke') => {
    if (!connectionId || !canGrant) return;
    setRunning(true);
    setError(null);
    setStatus(null);
    try {
      const { results } = await executeSql(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        [sql]
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        setError(failed.map((r) => ('error' in r ? r.error : 'failed')).join(' · '));
      } else {
        setStatus(kind === 'grant' ? 'Granted.' : 'Revoked.');
        await load();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setConfirm(null);
    }
  };

  const toggleGroup = (kind: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  if (!open) return null;

  const content = (
    <>
      {!embedded && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/50 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              Database Access
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Users and groups on the <span className="text-slate-300">connected database</span>, plus
              GRANT / REVOKE. FoxSchema logins and app permissions stay on Access control → App users
              / App roles.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      <div className="px-5 py-3 border-b border-slate-800 space-y-2.5 shrink-0 bg-slate-950/30">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 min-w-[14rem] flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Credential
            </span>
            <select
              data-testid="db-access-connection"
              value={connectionId}
              onChange={(e) => {
                const id = e.target.value;
                setConnectionId(id);
                if (!embedded) localStorage.setItem(LS_CONN, id);
                setPrincipals([]);
                setPrivileges([]);
                setSelectedName(null);
                setPasswordDraft('');
                setError(null);
              }}
              className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500"
            >
              <option value="">— Select credential —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  [{(PROVIDER_SETTINGS[c.dialect.toLowerCase()]?.label ?? c.dialect).toUpperCase()}]{' '}
                  {c.name}
                  {c.schema ? ` · ${c.schema}` : ''}
                </option>
              ))}
            </select>
          </label>
          {needsPassword && (
            <label className="flex flex-col gap-1 min-w-[10rem]">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Session password
              </span>
              <div className="flex gap-1">
                <input
                  type="password"
                  data-testid="db-access-password"
                  value={passwordDraft}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                  placeholder="••••••••"
                  className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 font-mono w-36"
                />
                <button
                  type="button"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-100"
                  onClick={() => {
                    if (!connectionId || !passwordDraft) return;
                    ensureConnectionSelected(connectionId);
                    submitSessionPassword(passwordDraft);
                    setPasswordDraft('');
                  }}
                >
                  Save
                </button>
              </div>
            </label>
          )}
          <button
            type="button"
            data-testid="db-access-load"
            disabled={!connectionId || loading || needsPassword}
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Load users
          </button>
          <input
            data-testid="db-access-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter users or groups"
            className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 min-w-[10rem]"
          />
        </div>
        {support && !support.query && (
          <p data-testid="db-access-unsupported" className="text-[11px] text-amber-200">
            {support.hint}
          </p>
        )}
        {hint && support?.query && (
          <p className="text-[11px] text-slate-500">{hint}</p>
        )}
      </div>

      {(error || warning || status) && (
        <div className="px-5 py-2 shrink-0 space-y-1">
          {error && (
            <p data-testid="db-access-error" className="text-[11px] text-rose-300">
              {error}
            </p>
          )}
          {warning && <p className="text-[11px] text-amber-200">{warning}</p>}
          {status && (
            <p data-testid="db-access-status" className="text-[11px] text-emerald-300">
              {status}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
        <div className="overflow-y-auto border-b md:border-b-0 md:border-r border-slate-800">
          {groups.map((group) => {
            const openGroup = expandedGroups.has(group.kind);
            const Chevron = openGroup ? ChevronDown : ChevronRight;
            return (
              <section key={group.kind} data-testid={`db-access-group-${group.kind}`}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-4 py-2 text-left bg-slate-950/50 border-b border-slate-800"
                  onClick={() => toggleGroup(group.kind)}
                >
                  <Chevron className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs font-bold text-slate-200">{group.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {group.principals.length}
                  </span>
                </button>
                {openGroup &&
                  (group.principals.length === 0 ? (
                    <p className="px-4 py-2 text-[11px] text-slate-500">No {group.label.toLowerCase()}.</p>
                  ) : (
                    <ul>
                      {group.principals.map((p) => (
                        <li key={p.name}>
                          <button
                            type="button"
                            data-testid={`db-access-principal-${p.name}`}
                            onClick={() => setSelectedName(p.name)}
                            className={`w-full text-left px-4 py-1.5 text-xs ${
                              selectedName === p.name
                                ? 'bg-amber-500/15 text-amber-100'
                                : 'text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            <span className="font-mono">{p.name}</span>
                            {p.kind !== 'user' && p.members.length > 0 && (
                              <span className="block text-[10px] text-slate-500">
                                {p.members.length} member{p.members.length === 1 ? '' : 's'}
                              </span>
                            )}
                            {p.kind === 'user' && p.memberOf.length > 0 && (
                              <span className="block text-[10px] text-slate-500">
                                member of {p.memberOf.join(', ')}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ))}
              </section>
            );
          })}
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3">
          {!selected ? (
            <p className="text-[11px] text-slate-500">Select a user or group to see privileges.</p>
          ) : (
            <>
              <div>
                <div className="text-xs font-bold text-slate-100 font-mono">{selected.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  {selected.kind}
                  {selected.canLogin ? ' · can login' : ''}
                </div>
                {selected.members.length > 0 && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Members: {selected.members.join(', ')}
                  </p>
                )}
                {selected.memberOf.length > 0 && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Member of: {selected.memberOf.join(', ')}
                  </p>
                )}
              </div>

              <div data-testid="db-access-privileges">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                  Object privileges ({selectedPrivs.length})
                </div>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  What this principal may do to tables, schemas and the database itself.
                </p>
                {selectedPrivs.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No object privileges returned for this principal.</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-500 text-left">
                        <th className="py-1 font-semibold">Privilege</th>
                        <th className="py-1 font-semibold">On</th>
                        <th className="py-1 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPrivs.map((priv, i) => {
                        const on =
                          [priv.objectSchema, priv.objectName].filter(Boolean).join('.') ||
                          priv.objectType;
                        return (
                          <tr key={`${priv.privilege}-${on}-${i}`} className="border-t border-slate-800">
                            <td className="py-1.5 text-slate-200">
                              {priv.state === 'deny' ? 'DENY ' : ''}
                              {priv.privilege}
                              {priv.grantable ? ' *' : ''}
                            </td>
                            <td className="py-1.5 text-slate-400 font-mono">{on}</td>
                            <td className="py-1.5 text-right">
                              <button
                                type="button"
                                data-testid={`db-access-revoke-${i}`}
                                disabled={!canGrant || running || !support?.grant}
                                onClick={() => {
                                  const built = buildGrantRevokeSql({
                                    dialect,
                                    action: 'revoke',
                                    privilege: priv.privilege,
                                    objectType: priv.objectType,
                                    objectSchema: priv.objectSchema,
                                    objectName: priv.objectName,
                                    grantee: selected.name,
                                    granteeKind:
                                      selected.kind === 'group'
                                        ? 'group'
                                        : selected.kind === 'role'
                                          ? 'role'
                                          : 'user',
                                  });
                                  if ('error' in built) {
                                    setError(built.error);
                                    return;
                                  }
                                  setConfirm({ title: 'Revoke privilege', sql: built.sql, kind: 'revoke' });
                                }}
                                className="text-[10px] font-bold uppercase tracking-wide text-rose-300 hover:text-rose-100 disabled:opacity-40"
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {selectedPrivs.length > 0 && (
                <p className="text-[10px] text-slate-500">
                  <span className="font-mono text-slate-400">*</span> may pass the privilege on to
                  others (WITH GRANT OPTION). <span className="font-mono text-slate-400">DENY</span>{' '}
                  overrides any grant of the same privilege.
                </p>
              )}

              <div data-testid="db-access-memberships">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                  Role memberships ({selectedMemberships.length})
                </div>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Roles this principal belongs to. It holds every privilege granted to them, on top
                  of the ones listed above.
                </p>
                {selectedMemberships.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Belongs to no roles.</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-500 text-left">
                        <th className="py-1 font-semibold">Role</th>
                        <th className="py-1 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMemberships.map((priv, i) => {
                        const roleName = priv.objectName ?? priv.privilege;
                        return (
                          <tr key={`member-${roleName}-${i}`} className="border-t border-slate-800">
                            <td className="py-1.5 text-slate-200 font-mono">{roleName}</td>
                            <td className="py-1.5 text-right">
                              <button
                                type="button"
                                data-testid={`db-access-remove-member-${i}`}
                                disabled={!canGrant || running || !support?.grant}
                                onClick={() => {
                                  const built = buildGrantRevokeSql({
                                    dialect,
                                    action: 'revoke',
                                    privilege: priv.privilege,
                                    objectType: 'ROLE',
                                    objectSchema: priv.objectSchema,
                                    objectName: priv.objectName,
                                    grantee: selected.name,
                                    granteeKind:
                                      selected.kind === 'group'
                                        ? 'group'
                                        : selected.kind === 'role'
                                          ? 'role'
                                          : 'user',
                                  });
                                  if ('error' in built) {
                                    setError(built.error);
                                    return;
                                  }
                                  setConfirm({
                                    title: 'Remove from role',
                                    sql: built.sql,
                                    kind: 'revoke',
                                  });
                                }}
                                className="text-[10px] font-bold uppercase tracking-wide text-rose-300 hover:text-rose-100 disabled:opacity-40"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div
                data-testid="db-access-grant-form"
                className="rounded-lg border border-slate-800 p-3 space-y-2"
              >
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Grant
                </div>
                {!canGrant && (
                  <p className="text-[11px] text-slate-500">
                    Your FoxSchema role cannot run GRANT / REVOKE. That is the{' '}
                    <span className="text-slate-200">{GRANT_PRIV_META?.label ?? 'Grant privileges'}</span>{' '}
                    permission on App roles (owner has it by default; editor does not).
                    {onOpenAppRoles ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          data-testid="db-access-open-app-roles"
                          onClick={onOpenAppRoles}
                          className="text-amber-200 hover:text-amber-100 underline-offset-2 hover:underline"
                        >
                          Open App roles
                        </button>
                      </>
                    ) : (
                      ' Open Access control → App roles to grant it.'
                    )}
                  </p>
                )}
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  What are you granting?
                  <select
                    data-testid="db-access-grant-kind"
                    value={grantObjectType === 'ROLE' ? 'membership' : 'privilege'}
                    onChange={(e) =>
                      setGrantObjectType(e.target.value === 'membership' ? 'ROLE' : 'TABLE')
                    }
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                  >
                    <option value="privilege">A privilege on an object</option>
                    <option value="membership">Membership of a role</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {grantObjectType !== 'ROLE' && (
                    <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                      Privilege
                      <select
                        data-testid="db-access-grant-privilege"
                        value={grantPrivilege}
                        onChange={(e) => setGrantPrivilege(e.target.value)}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                      >
                        {DB_OBJECT_PRIVILEGES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {grantObjectType !== 'ROLE' && (
                    <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                      On
                      <select
                        data-testid="db-access-grant-object-type"
                        value={grantObjectType}
                        onChange={(e) =>
                          setGrantObjectType(e.target.value as DbPrivilegeObjectType)
                        }
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                      >
                        <option value="TABLE">Table</option>
                        <option value="SCHEMA">Schema</option>
                        <option value="DATABASE">Database</option>
                      </select>
                    </label>
                  )}
                  {grantObjectType !== 'ROLE' && grantObjectType !== 'DATABASE' && (
                    <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                      Schema
                      <input
                        data-testid="db-access-grant-schema"
                        value={grantSchema}
                        onChange={(e) => setGrantSchema(e.target.value)}
                        placeholder={conn?.schema || 'schema'}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                    {grantObjectType === 'ROLE' ? 'Role' : 'Name'}
                    <input
                      data-testid="db-access-grant-name"
                      value={grantName}
                      onChange={(e) => setGrantName(e.target.value)}
                      placeholder={grantObjectType === 'ROLE' ? 'role name' : 'table'}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={grantWithOption}
                    onChange={(e) => setGrantWithOption(e.target.checked)}
                  />
                  WITH GRANT OPTION
                </label>
                {grantPreview && 'sql' in grantPreview && (
                  <pre
                    data-testid="db-access-grant-sql"
                    className="text-[11px] font-mono text-slate-300 bg-slate-950/70 border border-slate-800 rounded px-2 py-1.5 overflow-x-auto"
                  >
                    {grantPreview.sql}
                  </pre>
                )}
                {grantPreview && 'error' in grantPreview && (
                  <p className="text-[11px] text-slate-500">{grantPreview.error}</p>
                )}
                <button
                  type="button"
                  data-testid="db-access-grant"
                  disabled={
                    !canGrant ||
                    running ||
                    !grantPreview ||
                    'error' in grantPreview ||
                    !support?.grant ||
                    ((grantObjectType === 'TABLE' || grantObjectType === 'ROLE' || grantObjectType === 'SCHEMA') &&
                      !grantName.trim())
                  }
                  onClick={() => {
                    if (!grantPreview || 'error' in grantPreview) return;
                    setConfirm({ title: 'Grant privilege', sql: grantPreview.sql, kind: 'grant' });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
                >
                  <KeyRound className="w-3 h-3" />
                  Grant
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  const confirmPortal =
    confirm &&
    createPortal(
      <div
        className="fixed inset-0 z-[340] flex items-center justify-center bg-black/70 p-4"
        onClick={() => setConfirm(null)}
      >
        <div
          className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          data-testid="db-access-confirm"
        >
          <h3 className="text-sm font-bold text-slate-100 mb-2">{confirm.title}</h3>
          <pre className="text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded px-2 py-2 mb-4 overflow-x-auto">
            {confirm.sql}
          </pre>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="db-access-confirm-run"
              disabled={running}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border ${
                confirm.kind === 'revoke'
                  ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
              }`}
              onClick={() => void runSql(confirm.sql, confirm.kind)}
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Run
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  if (embedded) {
    return (
      <div data-testid="db-access-embedded" className="flex flex-col min-h-[24rem] -mx-4 -mb-3">
        {content}
        {confirmPortal}
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      data-testid="db-access-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
      {confirmPortal}
    </div>,
    document.body
  );
};
