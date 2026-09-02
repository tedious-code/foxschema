import React, { useMemo, useState, useEffect } from 'react';
import { Copy, Check, AlertTriangle, ShieldAlert, Info, RotateCcw, RefreshCw } from 'lucide-react';
import {
  availablePermissions,
  accessCapabilities,
  buildAccessSql,
  describePermission,
  invertAccessRequest,
  expandToInstance,
  permissionsForPreset,
  presetForPermissions,
  supportsAccessBuilder,
  type AccessPermission,
  type AccessPreset,
  type AccessScope,
  type PermissionRequest,
} from '../lib/access';
import { EmptyState, Field, RISK_STYLE, Segmented, inputCls } from './controls';
import { Autocomplete } from '@/shared/components/Autocomplete';
import { ObjectPicker } from './ObjectPicker';
import { PermissionMatrix } from './PermissionMatrix';
import { useAccessCatalog } from '../lib/useAccessCatalog';
import { useSyncStore } from '@/app/store/useSyncStore';
import type { AccessPrincipalDraft } from '../lib/access-draft';

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
export const PermissionBuilder: React.FC<{
  /** Prefill from User Management when the reader continues to grant access. */
  initialDraft?: AccessPrincipalDraft | null;
}> = ({ initialDraft = null }) => {
  const connections = useSyncStore((s) => s.connections);
  const [connectionId, setConnectionId] = useState(initialDraft?.connectionId ?? '');
  const conn = connections.find((c) => c.id === connectionId) || null;
  const dialect = conn?.dialect ?? '';

  const [principalName, setPrincipalName] = useState(initialDraft?.principalName ?? '');
  const [principalType, setPrincipalType] = useState<'user' | 'role'>(
    initialDraft?.principalType ?? 'user'
  );
  const [action, setAction] = useState<'grant' | 'revoke' | 'deny'>('grant');
  const [scopeType, setScopeType] = useState<AccessScope['type']>('schema');
  const [schema, setSchema] = useState(initialDraft ? conn?.schema ?? '' : '');
  const [database, setDatabase] = useState('');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [tableName, setTableName] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [sequencesText, setSequencesText] = useState('');
  const [permissions, setPermissions] = useState<AccessPermission[]>(
    permissionsForPreset('read-only')
  );
  const [includeFuture, setIncludeFuture] = useState(false);
  const [withGrantOption, setWithGrantOption] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  // The grid answers a different question from the flat form — "what may this
  // principal do to each of these objects?" rather than "one permission set on
  // one scope" — so it replaces the scope and permission controls rather than
  // sitting alongside them and competing for the same preview.
  const [builderMode, setBuilderMode] = useState<'scope' | 'grid'>('scope');
  const [gridRequests, setGridRequests] = useState<PermissionRequest[]>([]);
  const [everyDatabase, setEveryDatabase] = useState(false);
  // A stable identity for the grid's principal. The grid no longer depends on
  // it, but handing a child a new object every render is a re-render it does
  // not need.
  const gridPrincipal = useMemo(
    () => ({ type: principalType, name: principalName }),
    [principalType, principalName]
  );

  const caps = useMemo(() => accessCapabilities(dialect), [dialect]);
  // MySQL/MariaDB/Oracle have no schema-level GRANT — defaulting to "schema"
  // leaves the preview on a permanent error until the reader notices.
  useEffect(() => {
    const allowed: AccessScope['type'][] = [
      ...(caps.databaseScope ? (['database'] as const) : []),
      ...(caps.schemaScope ? (['schema'] as const) : []),
      ...(caps.tableScope ? (['tables'] as const) : []),
      ...(caps.columnScope ? (['columns'] as const) : []),
      ...(caps.sequenceScope ? (['sequences'] as const) : []),
    ];
    if (allowed.length && !allowed.includes(scopeType)) {
      setScopeType(allowed[0]!);
    }
  }, [caps, scopeType]);
  const catalog = useAccessCatalog(connectionId, conn);
  const principalOptions = useMemo(
    () =>
      catalog.principalOptions.filter((o) => {
        const p = catalog.principals.find((x) => x.name === o.value);
        if (!p) return true;
        return principalType === 'user' ? p.kind === 'user' : p.kind !== 'user';
      }),
    [catalog.principalOptions, catalog.principals, principalType]
  );
  const tableChoices = useMemo(
    () => catalog.tablesInSchema(schema),
    [catalog, schema]
  );
  const columnChoices = useMemo(
    () => catalog.columnsInTable(schema, tableName),
    [catalog, schema, tableName]
  );
  const offered = useMemo(
    () => availablePermissions(dialect, scopeType),
    [dialect, scopeType]
  );
  const preset = presetForPermissions(permissions);

  useEffect(() => {
    if (conn?.schema && !schema) setSchema(conn.schema);
    if (conn?.database && !database) setDatabase(conn.database);
  }, [conn?.schema, conn?.database, schema, database]);

  const scope: AccessScope = useMemo(() => {
    if (scopeType === 'database') return { type: 'database', database: database || conn?.database || '' };
    if (scopeType === 'tables') {
      return {
        type: 'tables',
        schema,
        tables: selectedTables,
      };
    }
    if (scopeType === 'columns') {
      return {
        type: 'columns',
        schema,
        table: tableName,
        columns: selectedColumns,
      };
    }
    if (scopeType === 'sequences') {
      const seqs = sequencesText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      return {
        type: 'sequences',
        schema,
        sequences: seqs.length > 0 ? seqs : undefined,
      };
    }
    return { type: 'schema', schema };
  }, [scopeType, schema, database, selectedTables, tableName, selectedColumns, sequencesText, conn?.database]);

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

  /**
   * Every request the preview must cover.
   *
   * One in the flat case; one per object group in the grid; one per database
   * when the grant is applied across the connection's server.
   */
  const requests: PermissionRequest[] = useMemo(() => {
    if (builderMode === 'grid') return gridRequests;
    if (everyDatabase && scopeType === 'database') {
      return expandToInstance(request, catalog.databaseOptions.map((o) => o.value));
    }
    return [request];
  }, [builderMode, gridRequests, everyDatabase, scopeType, request, catalog.databaseOptions]);

  // Regenerated on every change: no Submit button stands between the reader's
  // selection and seeing what it produces.
  const generated = useMemo(() => {
    if (!dialect || requests.length === 0) return null;
    const results = requests.map((r) =>
      buildAccessSql(showRevoke ? invertAccessRequest(r) : r, dialect)
    );
    // One bad request makes the whole preview untrustworthy: showing the good
    // statements beside a silently dropped one is how a reader runs a partial
    // grant believing it was the whole thing.
    const failed = results.find((r) => 'error' in r);
    if (failed) return failed;

    const ok = results as Exclude<(typeof results)[number], { error: string }>[];
    const RISK = ['low', 'elevated', 'administrative', 'critical'] as const;
    const seenWarning = new Set<string>();
    // Each request emits its own prerequisites, so several object groups in the
    // same schema each ask for `GRANT USAGE ON SCHEMA`. Running it twice is
    // harmless and reading it twice looks like a bug — and a reader who trims
    // what appears to be an accidental repeat could delete the only copy that
    // a later statement depends on.
    const seenStatement = new Set<string>();
    return {
      statements: ok.flatMap((r) => r.statements).filter((st) => {
        if (seenStatement.has(st.sql)) return false;
        seenStatement.add(st.sql);
        return true;
      }),
      // Fanning a grant across ten databases repeats the same caution ten
      // times; the reader needs to read it once.
      warnings: ok
        .flatMap((r) => r.warnings)
        .filter((w) => {
          if (seenWarning.has(w.message)) return false;
          seenWarning.add(w.message);
          return true;
        }),
      risk: ok.reduce(
        (worst, r) => (RISK.indexOf(r.risk) > RISK.indexOf(worst) ? r.risk : worst),
        'low' as (typeof RISK)[number]
      ),
    };
  }, [requests, dialect, showRevoke]);

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
  const fromUserManagement = Boolean(initialDraft?.principalName);

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

        {fromUserManagement && (
          <div
            data-testid="access-draft-banner"
            className="rounded-md border border-violet-500/35 bg-violet-500/10 px-3 py-2 text-[11px] text-violet-100"
          >
            Continuing from User Management for{' '}
            <code className="font-mono text-violet-50">{initialDraft!.principalName}</code>. Pick a
            scope and preset, then copy the GRANT SQL.
          </div>
        )}

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
                onChange={(v) => setAction(v as 'grant' | 'revoke' | 'deny')}
                options={[
                  { value: 'grant', label: 'Grant access' },
                  { value: 'revoke', label: 'Remove access' },
                  ...(caps.denyStatements
                    ? [{ value: 'deny', label: 'Deny (override)' }]
                    : []),
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
                <Autocomplete
                  data-testid="access-principal-name"
                  theme="slate"
                  value={principalName}
                  onChange={setPrincipalName}
                  options={principalOptions}
                  placeholder={principalType === 'user' ? 'report_user' : 'reporting_reader'}
                  className={`${inputCls} flex-1 font-mono`}
                />
              </div>
              {catalog.loadingPrincipals && (
                <p className="mt-1 text-[10px] text-slate-500">Loading users and roles…</p>
              )}
            </Field>
            <Field
              label="How do you want to say it?"
              hint="One permission set on one scope, or a privilege per object."
            >
              <Segmented
                value={builderMode}
                onChange={(v) => setBuilderMode(v as 'scope' | 'grid')}
                options={[
                  { value: 'scope', label: 'By scope' },
                  { value: 'grid', label: 'By object' },
                ]}
                testId="access-builder-mode"
              />
            </Field>

            {builderMode === 'grid' ? (
              <Field
                label="Objects"
                hint={`Schema ${schema || conn?.schema || '—'}. Struck-through columns are privileges ${
                  conn?.dialect ?? 'this engine'
                } cannot grant on one object.`}
              >
                <Autocomplete
                  data-testid="access-grid-schema"
                  theme="slate"
                  value={schema}
                  onChange={setSchema}
                  options={catalog.schemaOptions}
                  placeholder={conn?.schema || 'schema name'}
                  className={`${inputCls} font-mono mb-3`}
                />
                <PermissionMatrix
                  dialect={dialect}
                  principal={gridPrincipal}
                  action={action}
                  schema={schema || conn?.schema || ''}
                  withGrantOption={withGrantOption}
                  tableChoices={tableChoices}
                  onChange={setGridRequests}
                />
              </Field>
            ) : (
              <>
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
                  ...(caps.columnScope ? [{ value: 'columns', label: 'Columns' }] : []),
                  ...(caps.sequenceScope ? [{ value: 'sequences', label: 'Sequences' }] : []),
                ]}
                testId="access-scope"
              />
              <div className="mt-2 flex flex-col gap-2">
                {(scopeType === 'tables' || scopeType === 'columns') && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="access-load-objects"
                      disabled={!connectionId || catalog.loadingTables}
                      onClick={() => void catalog.loadTables()}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-[10px] font-semibold text-slate-300 disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${catalog.loadingTables ? 'animate-spin' : ''}`}
                      />
                      {catalog.tablesReady ? 'Refresh tables' : 'Load tables'}
                    </button>
                    {!catalog.tablesReady && (
                      <span className="text-[10px] text-slate-500">
                        Pick tables/columns from the schema cache.
                      </span>
                    )}
                  </div>
                )}
                {scopeType === 'database' && (
                  <>
                    <Autocomplete
                      data-testid="access-database"
                      theme="slate"
                      value={database || conn?.database || ''}
                      onChange={setDatabase}
                      options={catalog.databaseOptions}
                      placeholder={conn?.database || 'database name'}
                      className={`${inputCls} font-mono`}
                      disabled={everyDatabase}
                    />
                    <label className="flex items-start gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        data-testid="access-every-database"
                        checked={everyDatabase}
                        onChange={(e) => setEveryDatabase(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Every database on this connection
                        <span className="block text-slate-500">
                          {catalog.databaseOptions.length > 0
                            ? `Repeats the grant for each of the ${catalog.databaseOptions.length} databases this connection can see. Privileges are still granted one database at a time — there is no single statement that covers a server.`
                            : 'No databases loaded yet, so this will fall back to the one named above.'}
                        </span>
                      </span>
                    </label>
                  </>
                )}
                {scopeType !== 'database' && (
                  <Autocomplete
                    data-testid="access-schema"
                    theme="slate"
                    value={schema}
                    onChange={setSchema}
                    options={catalog.schemaOptions}
                    placeholder={conn?.schema || 'schema name'}
                    className={`${inputCls} font-mono`}
                  />
                )}
                {scopeType === 'tables' && (
                  <ObjectPicker
                    testId="access-tables"
                    label="Tables"
                    items={tableChoices}
                    selected={selectedTables}
                    onChange={setSelectedTables}
                    emptyHint="Choose a schema and load tables, or type a schema name first."
                  />
                )}
                {scopeType === 'columns' && (
                  <>
                    <Autocomplete
                      data-testid="access-table"
                      theme="slate"
                      value={tableName}
                      onChange={setTableName}
                      options={tableChoices.map((t) => ({ value: t }))}
                      placeholder="orders"
                      className={`${inputCls} font-mono`}
                    />
                    <ObjectPicker
                      testId="access-columns"
                      label="Columns"
                      items={columnChoices}
                      selected={selectedColumns}
                      onChange={setSelectedColumns}
                      emptyHint={
                        tableName
                          ? 'No columns in cache for this table.'
                          : 'Pick a table first.'
                      }
                    />
                  </>
                )}
                {scopeType === 'sequences' && (
                  <textarea
                    data-testid="access-sequences"
                    value={sequencesText}
                    onChange={(e) => setSequencesText(e.target.value)}
                    placeholder="Leave empty for all sequences in schema, or list names"
                    rows={2}
                    className={`${inputCls} font-mono`}
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
            </>
            )}

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
