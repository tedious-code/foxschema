/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Create, change and drop database accounts — as SQL to review and run.
 *
 * This panel generates statements and stops there, like the Permission Builder
 * next to it. Fox Schema does not create accounts.
 *
 * Users and roles are kept apart on purpose. They are separate things on every
 * engine that has both — a role holds privileges, a user logs in — and the
 * first choice on this screen is which one you mean, because the generated SQL
 * differs from that point on.
 *
 * No password is ever typed here. Statements that need one carry a placeholder
 * for the DBA to replace, so a real password never enters the browser, the
 * store, or history.
 */
import React, { useMemo, useState } from 'react';
import { Copy, Check, AlertTriangle, ShieldAlert, Info, UserCog, KeyRound } from 'lucide-react';
import {
  PASSWORD_PLACEHOLDER,
  buildUserSql,
  userManagementSupport,
  type PrincipalType,
  type UserAction,
  type UserAlteration,
  type UserRequest,
} from '../lib/access';
import { EmptyState, Field, RISK_STYLE, Segmented, inputCls } from './controls';
import { useSyncStore } from '@/app/store/useSyncStore';

const ACTION_LABEL: Record<UserAction, string> = {
  create: 'Add',
  alter: 'Edit',
  drop: 'Drop',
};

const ALTERATION_LABEL: Record<UserAlteration, string> = {
  password: 'Set password',
  rename: 'Rename',
  disable: 'Disable login',
  enable: 'Enable login',
};

/** What each principal type is, in one line, shown under the choice. */
const TYPE_HINT: Record<PrincipalType, string> = {
  user: 'An account that connects to the database. Grant it privileges, or add it to a role.',
  role: 'A named set of privileges. It does not log in; you grant it to users.',
};

export const UserManagement: React.FC = () => {
  const connections = useSyncStore((s) => s.connections);
  const [connectionId, setConnectionId] = useState('');
  const conn = connections.find((c) => c.id === connectionId) || null;
  const dialect = conn?.dialect ?? '';

  const [principalType, setPrincipalType] = useState<PrincipalType>('user');
  const [action, setAction] = useState<UserAction>('create');
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [alteration, setAlteration] = useState<UserAlteration>('password');
  const [host, setHost] = useState('%');
  const [cascade, setCascade] = useState(false);
  const [copied, setCopied] = useState(false);

  const support = useMemo(() => userManagementSupport(dialect), [dialect]);
  const isMysqlFamily = ['mysql', 'mariadb', 'tidb'].includes(dialect.toLowerCase());
  const isOracle = dialect.toLowerCase() === 'oracle';

  const request: UserRequest = useMemo(
    () => ({
      action,
      principalType,
      name,
      newName,
      alteration,
      host: isMysqlFamily ? host : undefined,
      cascade,
    }),
    [action, principalType, name, newName, alteration, host, isMysqlFamily, cascade]
  );

  // Regenerated on every change, so the SQL is always what the form says.
  const generated = useMemo(
    () => (dialect && name.trim() ? buildUserSql(request, dialect) : null),
    [request, dialect, name]
  );

  const sqlText =
    generated && !('error' in generated)
      ? generated.statements.map((s) => s.sql).join('\n\n')
      : '';

  const copy = async () => {
    if (!sqlText) return;
    await navigator.clipboard.writeText(sqlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const noun = principalType === 'user' ? 'user' : 'role';

  return (
    <div className="flex-1 flex min-h-0" data-testid="user-management">
      {/* ── Left: what to change ─────────────────────────────────────── */}
      <div className="w-[46%] min-w-[380px] overflow-y-auto border-r border-slate-800 p-5 flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-bold text-slate-100">User Management</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Add, edit or drop a database account. Fox Schema writes the SQL for your engine — you
            review it and run it yourself.
          </p>
        </div>

        <Field label="Database">
          <select
            data-testid="user-connection"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className={inputCls}
          >
            <option value="">Select a connection…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.dialect}
              </option>
            ))}
          </select>
        </Field>

        {dialect && !support.supported && (
          <div
            data-testid="user-unsupported"
            className="rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2.5 text-[11px] text-slate-400"
          >
            {support.reason}
          </div>
        )}

        {dialect && support.supported && (
          <>
            <Field
              label="What are you managing?"
              hint={TYPE_HINT[principalType]}
            >
              <Segmented
                testId="user-type"
                value={principalType}
                onChange={(v) => setPrincipalType(v as PrincipalType)}
                options={[
                  { value: 'user', label: 'User (logs in)' },
                  { value: 'role', label: 'Role (holds privileges)' },
                ]}
              />
            </Field>

            <Field label="Action">
              <Segmented
                testId="user-action"
                value={action}
                onChange={(v) => setAction(v as UserAction)}
                options={(['create', 'alter', 'drop'] as UserAction[]).map((a) => ({
                  value: a,
                  label: `${ACTION_LABEL[a]} ${noun}`,
                }))}
              />
            </Field>

            <Field label={action === 'create' ? `New ${noun} name` : `${noun} name`}>
              <input
                data-testid="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={principalType === 'user' ? 'report_user' : 'reporting_reader'}
                className={inputCls}
              />
            </Field>

            {isMysqlFamily && principalType === 'user' && (
              <Field
                label="Host"
                hint="MySQL identifies an account by name and host together, so a different host is a different account."
              >
                <input
                  data-testid="user-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="%"
                  className={inputCls}
                />
              </Field>
            )}

            {action === 'alter' && (
              <Field label="Change">
                <Segmented
                  testId="user-alteration"
                  value={alteration}
                  onChange={(v) => setAlteration(v as UserAlteration)}
                  options={(
                    ['password', 'rename', 'disable', 'enable'] as UserAlteration[]
                  ).map((a) => ({
                    value: a,
                    label: ALTERATION_LABEL[a],
                    disabled:
                      (a === 'password' && principalType === 'role') ||
                      (a === 'rename' && !support.canRename) ||
                      ((a === 'disable' || a === 'enable') && !support.canDisable),
                    title:
                      a === 'password' && principalType === 'role'
                        ? 'A role has no password.'
                        : undefined,
                  }))}
                />
              </Field>
            )}

            {action === 'alter' && alteration === 'rename' && (
              <Field label="New name">
                <input
                  data-testid="user-new-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className={inputCls}
                />
              </Field>
            )}

            {action === 'drop' && isOracle && principalType === 'user' && (
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
                    Oracle refuses to drop an account that owns objects. Those objects are not
                    recoverable.
                  </span>
                </span>
              </label>
            )}

            {action === 'create' && principalType === 'user' && support.canCreateUser && (
              <div className="flex items-start gap-2 rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-400">
                <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Fox Schema never asks for the password. The SQL carries{' '}
                  <code className="text-slate-300">{PASSWORD_PLACEHOLDER}</code> for you to replace
                  before you run it.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right: SQL ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-100">SQL Preview</h2>
          {generated && !('error' in generated) && (
            <span
              data-testid="user-risk"
              className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${RISK_STYLE[generated.risk]}`}
            >
              {generated.risk}
            </span>
          )}
          <div className="ml-auto">
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
          </div>
        </div>

        {!generated && (
          <EmptyState
            title="Manage a database account"
            body="Choose a connection, pick user or role, and name it. Fox Schema generates the SQL your engine needs — it never creates accounts for you."
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
              Review and copy the generated SQL. Fox Schema does not create, change or drop
              accounts.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
