import React, { useMemo, useState } from 'react';
import { Copy, Check, AlertTriangle, ShieldAlert, Info, RotateCcw } from 'lucide-react';
import {
  availablePermissions,
  accessCapabilities,
  buildAccessSql,
  describePermission,
  invertAccessRequest,
  permissionsForPreset,
  presetForPermissions,
  supportsAccessBuilder,
  type AccessPermission,
  type AccessPreset,
  type AccessScope,
  type PermissionRequest,
  type PermissionRisk,
} from '../../lib/access';
import { useSyncStore } from '../../store/useSyncStore';

const RISK_STYLE: Record<PermissionRisk, string> = {
  low: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  elevated: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  administrative: 'text-orange-300 border-orange-500/40 bg-orange-500/10',
  critical: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
};

const PRESET_LABEL: Record<AccessPreset, string> = {
  'read-only': 'Read only',
  'read-write': 'Read and write',
  'application-writer': 'Application writer',
  'procedure-executor': 'Execute procedures',
  'schema-developer': 'Manage schema',
  custom: 'Custom',
};

/**
 * Intent-first permission builder.
 *
 * The reader answers "what should this user be able to do?" and sees the SQL
 * their engine needs. FoxSchema never runs it — the panel is a generator and an
 * explanation, and the database stays the source of truth.
 */
export const PermissionBuilder: React.FC = () => {
  const connections = useSyncStore((s) => s.connections);
  const [connectionId, setConnectionId] = useState('');
  const conn = connections.find((c) => c.id === connectionId) || null;
  const dialect = conn?.dialect ?? '';

  const [principalName, setPrincipalName] = useState('');
  const [principalType, setPrincipalType] = useState<'user' | 'role'>('user');
  const [action, setAction] = useState<'grant' | 'revoke'>('grant');
  const [scopeType, setScopeType] = useState<AccessScope['type']>('schema');
  const [schema, setSchema] = useState('');
  const [database, setDatabase] = useState('');
  const [tablesText, setTablesText] = useState('');
  const [permissions, setPermissions] = useState<AccessPermission[]>(
    permissionsForPreset('read-only')
  );
  const [includeFuture, setIncludeFuture] = useState(false);
  const [withGrantOption, setWithGrantOption] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);

  const caps = useMemo(() => accessCapabilities(dialect), [dialect]);
  const offered = useMemo(
    () => availablePermissions(dialect, scopeType),
    [dialect, scopeType]
  );
  const preset = presetForPermissions(permissions);

  const scope: AccessScope = useMemo(() => {
    if (scopeType === 'database') return { type: 'database', database: database || conn?.database || '' };
    if (scopeType === 'tables') {
      return {
        type: 'tables',
        schema,
        tables: tablesText.split(/[\n,]/).map((t) => t.trim()).filter(Boolean),
      };
    }
    return { type: 'schema', schema };
  }, [scopeType, schema, database, tablesText, conn?.database]);

  const request: PermissionRequest = useMemo(
    () => ({
      principal: { type: principalType, name: principalName },
      action,
      permissions,
      scope,
      includeFutureObjects: includeFuture && caps.futureObjects,
      withGrantOption,
    }),
    [principalType, principalName, action, permissions, scope, includeFuture, caps.futureObjects, withGrantOption]
  );

  // Regenerated on every change: no Submit button stands between the reader's
  // selection and seeing what it produces.
  const generated = useMemo(
    () => (dialect ? buildAccessSql(showRevoke ? invertAccessRequest(request) : request, dialect) : null),
    [request, dialect, showRevoke]
  );

  const sqlText =
    generated && !('error' in generated)
      ? generated.statements.map((s) => s.sql).join('\n\n')
      : '';

  const togglePermission = (p: AccessPermission) =>
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const copy = async () => {
    if (!sqlText) return;
    await navigator.clipboard.writeText(sqlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const unsupported = dialect && !supportsAccessBuilder(dialect);

  return (
    <div className="flex-1 flex min-h-0" data-testid="permission-builder">
      {/* ── Left: intent ─────────────────────────────────────────────── */}
      <div className="w-[46%] min-w-[380px] overflow-y-auto border-r border-slate-800 p-5 flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-bold text-slate-100">Permission Builder</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Describe the access you need. Fox Schema generates the SQL for your engine and never
            applies it for you.
          </p>
        </div>

        <Field label="Database">
          <select
            data-testid="access-connection"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className={inputCls}
          >
            <option value="">Choose a saved connection…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                [{(c.dialect || '').toUpperCase()}] {c.name}
              </option>
            ))}
          </select>
        </Field>

        {unsupported ? (
          <div
            data-testid="access-unsupported"
            className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-[11px] text-slate-400"
          >
            {conn?.dialect} has no GRANT model, so there is nothing to build here.
          </div>
        ) : (
          <>
            <Field label="Action">
              <Segmented
                value={action}
                onChange={(v) => setAction(v as 'grant' | 'revoke')}
                options={[
                  { value: 'grant', label: 'Grant access' },
                  { value: 'revoke', label: 'Remove access' },
                ]}
                testId="access-action"
              />
            </Field>

            <Field label="Who">
              <div className="flex gap-2">
                <Segmented
                  value={principalType}
                  onChange={(v) => setPrincipalType(v as 'user' | 'role')}
                  options={[
                    { value: 'user', label: 'User' },
                    { value: 'role', label: 'Role' },
                  ]}
                  testId="access-principal-type"
                />
                <input
                  data-testid="access-principal-name"
                  value={principalName}
                  onChange={(e) => setPrincipalName(e.target.value)}
                  placeholder={principalType === 'user' ? 'report_user' : 'reporting_reader'}
                  className={`${inputCls} flex-1 font-mono`}
                />
              </div>
            </Field>

            <Field label="What should they be able to do?">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PRESET_LABEL) as AccessPreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-testid={`access-preset-${p}`}
                    onClick={() => p !== 'custom' && setPermissions(permissionsForPreset(p))}
                    disabled={p === 'custom'}
                    className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold transition ${
                      preset === p
                        ? 'border-sky-500/50 bg-sky-500/15 text-sky-100'
                        : 'border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40'
                    }`}
                  >
                    {PRESET_LABEL[p]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Where should this apply?">
              <Segmented
                value={scopeType}
                onChange={(v) => setScopeType(v as AccessScope['type'])}
                options={[
                  ...(caps.databaseScope ? [{ value: 'database', label: 'Database' }] : []),
                  ...(caps.schemaScope ? [{ value: 'schema', label: 'Schema' }] : []),
                  ...(caps.tableScope ? [{ value: 'tables', label: 'Tables' }] : []),
                ]}
                testId="access-scope"
              />
              <div className="mt-2">
                {scopeType === 'database' && (
                  <input
                    data-testid="access-database"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder={conn?.database || 'database name'}
                    className={`${inputCls} font-mono`}
                  />
                )}
                {scopeType !== 'database' && (
                  <input
                    data-testid="access-schema"
                    value={schema}
                    onChange={(e) => setSchema(e.target.value)}
                    placeholder={conn?.schema || 'schema name'}
                    className={`${inputCls} font-mono`}
                  />
                )}
                {scopeType === 'tables' && (
                  <textarea
                    data-testid="access-tables"
                    value={tablesText}
                    onChange={(e) => setTablesText(e.target.value)}
                    placeholder="orders, customers"
                    rows={3}
                    className={`${inputCls} font-mono mt-2`}
                  />
                )}
              </div>
            </Field>

            {caps.futureObjects && scopeType === 'schema' && (
              <label className="flex items-start gap-2 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  data-testid="access-future"
                  checked={includeFuture}
                  onChange={(e) => setIncludeFuture(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Apply to tables created later
                  <span className="block text-slate-500">
                    Existing and future tables need different statements on this engine.
                  </span>
                </span>
              </label>
            )}

            <Field label={`Permissions (${permissions.length})`}>
              <div className="grid grid-cols-2 gap-1.5">
                {offered.map((p) => {
                  const d = describePermission(p);
                  return (
                    <label
                      key={p}
                      className="flex items-start gap-2 rounded-md border border-slate-800 px-2 py-1.5 text-[11px] hover:border-slate-700"
                    >
                      <input
                        type="checkbox"
                        data-testid={`access-perm-${p}`}
                        checked={permissions.includes(p)}
                        onChange={() => togglePermission(p)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="text-slate-200 font-semibold">{d.label}</span>{' '}
                        <span className="text-slate-500 font-mono">({d.privilegeHint})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>

            {caps.grantOption && (
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  data-testid="access-grant-option"
                  checked={withGrantOption}
                  onChange={(e) => setWithGrantOption(e.target.checked)}
                />
                Let them pass this access on to others
              </label>
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
              data-testid="access-risk"
              className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${RISK_STYLE[generated.risk]}`}
            >
              {generated.risk}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              data-testid="access-toggle-revoke"
              onClick={() => setShowRevoke((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 text-[11px] font-semibold text-slate-300 hover:text-slate-100"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {showRevoke ? 'Show original' : 'Show the reverse'}
            </button>
            <button
              type="button"
              data-testid="access-copy"
              onClick={copy}
              disabled={!sqlText}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-[11px] font-bold text-sky-100 disabled:opacity-40"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
        </div>

        {!dialect && (
          <EmptyState
            title="Build database access"
            body="Choose a connection, name a user or role, and describe the access you want. Fox Schema generates the SQL your engine needs."
          />
        )}

        {generated && 'error' in generated && (
          <div
            data-testid="access-error"
            className="rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2.5 text-[11px] text-amber-200"
          >
            {generated.error}
          </div>
        )}

        {generated && !('error' in generated) && (
          <>
            <div
              data-testid="access-sql"
              className="rounded-md border border-slate-800 bg-slate-950/70 divide-y divide-slate-800/70"
            >
              {generated.statements.map((s, i) => (
                <div key={i} className="p-3">
                  <pre className="text-[12px] font-mono text-slate-100 whitespace-pre-wrap break-words">
                    {s.sql}
                  </pre>
                  {/* Each statement explains itself: a reader about to run this
                      against production should not have to infer what a line does. */}
                  <p className="mt-1.5 text-[11px] text-slate-500">{s.explanation}</p>
                </div>
              ))}
            </div>

            {generated.warnings.length > 0 && (
              <div className="flex flex-col gap-1.5" data-testid="access-warnings">
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

            <p className="text-[11px] text-slate-500">
              Review and copy the generated SQL. Fox Schema does not apply access changes.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none focus:border-sky-500';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
    <div className="mt-1">{children}</div>
  </div>
);

const Segmented: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId: string;
}> = ({ value, onChange, options, testId }) => (
  <div className="inline-flex rounded-md border border-slate-700 overflow-hidden" data-testid={testId}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        data-testid={`${testId}-${o.value}`}
        onClick={() => onChange(o.value)}
        className={`px-2.5 py-1 text-[11px] font-semibold transition ${
          value === o.value
            ? 'bg-slate-800 text-slate-100'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const EmptyState: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-6 text-center">
    <p className="text-sm font-bold text-slate-300">{title}</p>
    <p className="mt-1 text-[11px] text-slate-500 max-w-md mx-auto">{body}</p>
  </div>
);
