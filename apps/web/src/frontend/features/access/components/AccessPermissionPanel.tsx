/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Access → Permission: live grant/revoke against a saved connection.
 *
 * Uses the same dialect-aware sectioned UI as Database Access
 * (`DbAccessPermissionSections`) — not a mock prototype.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  dialectSupportsDbAccess,
  privilegesForPrincipal,
  type DbPrincipal,
  type DbPrivilege,
} from '@foxschema/sql';
import { fetchDbAccess } from '@/shared/api/schemaApi';
import { runAccessSql } from '@/shared/api/accessSql';
import { useSyncStore } from '@/app/store/useSyncStore';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { useAuthStore } from '@/app/store/authStore';
import { EmptyState, inputCls, labelCls } from './controls';
import {
  DbAccessPermissionSections,
  type DbAccessConfirmRequest,
} from './DbAccessPermissionSections';

export const AccessPermissionPanel: React.FC = () => {
  const connections = useSyncStore((s) => s.connections);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const canGrant = useAuthStore((s) => s.can('editor.grant'));

  const [connectionId, setConnectionId] = useState('');
  const [principalName, setPrincipalName] = useState('');
  const [principals, setPrincipals] = useState<DbPrincipal[]>([]);
  const [privileges, setPrivileges] = useState<DbPrivilege[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DbAccessConfirmRequest | null>(null);
  const loadToken = useRef(0);

  const conn = connections.find((c) => c.id === connectionId) || null;
  const dialect = conn?.dialect ?? '';
  const support = dialect ? dialectSupportsDbAccess(dialect) : null;

  const selected = useMemo(
    () => principals.find((p) => p.name === principalName) ?? null,
    [principals, principalName]
  );

  const selectedPrivs = useMemo(
    () =>
      selected
        ? privilegesForPrincipal(privileges, selected.name).filter((p) => p.objectType !== 'ROLE')
        : [],
    [privileges, selected]
  );

  const load = useCallback(async () => {
    if (!connectionId) return;
    const mine = ++loadToken.current;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const data = await fetchDbAccess(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        { schema: conn?.schema }
      );
      if (loadToken.current !== mine) return;
      setPrincipals(data.principals ?? []);
      setPrivileges(data.privileges ?? []);
      if (!principalName && data.principals?.[0]) {
        setPrincipalName(data.principals[0].name);
      } else if (
        principalName &&
        data.principals &&
        !data.principals.some((p) => p.name === principalName)
      ) {
        setPrincipalName(data.principals[0]?.name ?? '');
      }
    } catch (err: unknown) {
      if (loadToken.current !== mine) return;
      setError(err instanceof Error ? err.message : String(err));
      setPrincipals([]);
      setPrivileges([]);
    } finally {
      if (loadToken.current === mine) setLoading(false);
    }
  }, [connectionId, sessionPasswords, conn?.schema, principalName]);

  useEffect(() => {
    if (!connectionId) {
      setPrincipals([]);
      setPrivileges([]);
      setPrincipalName('');
      return;
    }
    void load();
    // Load when connection changes; principalName is only used to preserve selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: connection-driven reload
  }, [connectionId]);

  const runSql = async (sql: string, kind: 'grant' | 'revoke') => {
    if (!connectionId || !canGrant) return;
    setRunning(true);
    setError(null);
    setStatus(null);
    try {
      const outcome = await runAccessSql(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        sql
      );
      if (!outcome.ok) {
        setError(outcome.error);
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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 gap-3" data-testid="access-permission-panel">
      <div>
        <h2 className="text-sm font-bold text-slate-100">Permission</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Grant and revoke with dialect-correct SQL. Same sectioned UI as Database Access —
          General CREATE plus tables, views, procedures, and functions.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 min-w-[14rem] flex-1">
          <span className={labelCls}>Database</span>
          <select
            data-testid="access-permission-connection"
            value={connectionId}
            onChange={(e) => {
              if (e.target.value === connectionId) return;
              ++loadToken.current;
              setConnectionId(e.target.value);
              setPrincipals([]);
              setPrivileges([]);
              setPrincipalName('');
              setError(null);
              setStatus(null);
            }}
            className={inputCls}
          >
            <option value="">Choose a saved connection…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.dialect}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="access-permission-reload"
          disabled={!connectionId || loading}
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Reload
        </button>
      </div>

      {!connectionId && (
        <EmptyState
          title="Choose a connection"
          body="Pick a saved database to load principals and grant privileges."
          testId="access-permission-needs-connection"
        />
      )}

      {connectionId && error && (
        <p className="text-[11px] text-rose-300" data-testid="access-permission-error">
          {error}
        </p>
      )}
      {connectionId && status && (
        <p className="text-[11px] text-emerald-300" data-testid="access-permission-status">
          {status}
        </p>
      )}

      {connectionId && !error && (
        <>
          <label className="flex flex-col gap-1 max-w-sm">
            <span className={labelCls}>Principal</span>
            <select
              data-testid="access-permission-principal"
              value={principalName}
              onChange={(e) => setPrincipalName(e.target.value)}
              disabled={loading || principals.length === 0}
              className={inputCls}
            >
              {principals.length === 0 ? (
                <option value="">{loading ? 'Loading…' : 'No principals found'}</option>
              ) : (
                principals.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} · {p.kind}
                  </option>
                ))
              )}
            </select>
          </label>

          {selected && (
            <DbAccessPermissionSections
              dialect={dialect}
              connectionId={connectionId}
              database={conn?.database}
              defaultSchema={conn?.schema}
              principal={{
                type: selected.kind === 'user' ? 'user' : 'role',
                name: selected.name,
                kind: selected.kind,
              }}
              privileges={selectedPrivs}
              canGrant={canGrant}
              grantSupported={Boolean(support?.grant)}
              running={running}
              onConfirm={(req) => setConfirm(req)}
              onError={(msg) => setError(msg)}
            />
          )}
        </>
      )}

      {confirm &&
        createPortal(
          <div
            className="fixed inset-0 z-[340] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setConfirm(null)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="access-permission-confirm"
            >
              <h3 className="text-sm font-bold text-slate-100 mb-2">{confirm.title}</h3>
              <pre className="text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded px-2 py-2 mb-4 overflow-x-auto whitespace-pre-wrap">
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
                  data-testid="access-permission-confirm-run"
                  disabled={running || !canGrant}
                  onClick={() => void runSql(confirm.sql, confirm.kind)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border disabled:opacity-40 ${
                    confirm.kind === 'revoke'
                      ? 'border-rose-500/50 bg-rose-500/20 text-rose-50'
                      : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                  }`}
                >
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {confirm.kind === 'revoke' ? 'Execute revoke' : 'Execute grant'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
