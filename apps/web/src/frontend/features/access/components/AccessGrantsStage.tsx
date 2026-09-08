/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Access → Grants stage: presets + object×privilege matrix + GRANT SQL.
 * Generate-only — matches the Access mockup chrome.
 */
import React, { useMemo, useState } from 'react';
import { Copy, FileCode2 } from 'lucide-react';
import {
  buildAccessReconciliationSql,
  buildAccessSql,
  diffAccessDesired,
  permissionsForPreset,
  type AccessPermission,
  type AccessPreset,
  type AccessDesiredState,
  type DbPrivilege,
  type PermissionRequest,
} from '../lib/access';
import { useAllSchemaObjects } from '../lib/useAllSchemaObjects';
import { PermissionMatrix } from './PermissionMatrix';
import { Segmented } from './controls';
import {
  DbAccessPermissionSections,
  type DbAccessConfirmRequest,
} from './DbAccessPermissionSections';
import type { DbPrincipal } from '@foxschema/sql';

const PRESET_LABEL: Record<Exclude<AccessPreset, 'custom'>, string> = {
  'read-only': 'Read only',
  'read-write': 'Read and write',
  'application-writer': 'Application writer',
  'procedure-executor': 'Execute procedures',
  'schema-developer': 'Manage schema',
};

const STATUS_STYLE: Record<string, string> = {
  match: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  missing: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
  extra: 'text-rose-200 bg-rose-500/10 border-rose-500/30',
  denied: 'text-violet-200 bg-violet-500/10 border-violet-500/30',
};

type GrantsMode = 'matrix' | 'live';

export const AccessGrantsStage: React.FC<{
  dialect: string;
  connectionId: string;
  database?: string;
  defaultSchema?: string;
  principal: DbPrincipal;
  privileges: DbPrivilege[];
  canGrant: boolean;
  grantSupported: boolean;
  onConfirm: (req: DbAccessConfirmRequest) => void;
  onError: (msg: string) => void;
}> = ({
  dialect,
  connectionId,
  database,
  defaultSchema,
  principal,
  privileges,
  canGrant,
  grantSupported,
  onConfirm,
  onError,
}) => {
  const [mode, setMode] = useState<GrantsMode>('matrix');
  const [activePreset, setActivePreset] = useState<AccessPreset | 'custom'>('custom');
  const [gridPreset, setGridPreset] = useState<{
    permissions: AccessPermission[];
    nonce: number;
  } | null>(null);
  const [gridRequests, setGridRequests] = useState<PermissionRequest[]>([]);
  const catalog = useAllSchemaObjects(connectionId, mode === 'matrix');

  const accessPrincipal = useMemo(
    () => ({
      type: (principal.kind === 'user' ? 'user' : 'role') as 'user' | 'role',
      name: principal.name,
    }),
    [principal]
  );

  const desired: AccessDesiredState = useMemo(
    () => ({
      principal: accessPrincipal,
      requests: gridRequests.map((r) => ({
        ...r,
        principal: accessPrincipal,
      })),
    }),
    [accessPrincipal, gridRequests]
  );

  const diff = useMemo(() => {
    if (gridRequests.length === 0) return null;
    return diffAccessDesired(desired, privileges);
  }, [desired, privileges, gridRequests.length]);

  const sqlText = useMemo(() => {
    if (gridRequests.length === 0) return '';
    if (diff && privileges.length > 0) {
      const recon = buildAccessReconciliationSql(diff, dialect);
      if (!('error' in recon) && recon.statements.length > 0) {
        return recon.statements.map((s) => s.sql).join('\n\n');
      }
      if ('error' in recon && /matches the catalog/i.test(recon.error)) {
        return '-- Desired matrix matches the live catalog. Nothing to grant or revoke.';
      }
    }
    return desired.requests
      .map((r) => {
        const built = buildAccessSql(r, dialect);
        if ('error' in built) return `-- ${built.error}`;
        return built.statements.map((s) => s.sql).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
  }, [dialect, desired.requests, diff, privileges.length, gridRequests.length]);

  const applyPreset = (preset: Exclude<AccessPreset, 'custom'>) => {
    setActivePreset(preset);
    setGridPreset((prev) => ({
      permissions: permissionsForPreset(preset),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  const openSql = () => {
    if (!sqlText.trim() || sqlText.startsWith('-- Desired matrix matches')) {
      onError(sqlText || 'No GRANT SQL for this selection.');
      return;
    }
    if (sqlText.split('\n').every((line) => line.trim().startsWith('--') || !line.trim())) {
      onError('No GRANT SQL for this selection.');
      return;
    }
    onConfirm({
      title: `GRANT SQL for ${principal.name}`,
      sql: sqlText,
      kind: 'grant',
    });
  };

  return (
    <div className="space-y-3" data-testid="access-grants-stage">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          testId="access-grants-mode"
          value={mode}
          onChange={(v) => setMode(v as GrantsMode)}
          options={[
            { value: 'matrix', label: 'Desired matrix' },
            { value: 'live', label: 'Live catalog' },
          ]}
        />
        <p className="text-[11px] text-slate-500">
          Fox Schema generates GRANT/REVOKE SQL — it does not apply it.
        </p>
      </div>

      {mode === 'live' ? (
        <DbAccessPermissionSections
          dialect={dialect}
          connectionId={connectionId}
          database={database}
          defaultSchema={defaultSchema}
          principal={{
            type: accessPrincipal.type,
            name: principal.name,
            kind: principal.kind,
          }}
          privileges={privileges}
          canGrant={canGrant}
          grantSupported={grantSupported}
          generateOnly
          onConfirm={onConfirm}
          onError={onError}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="access-grants-presets">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Presets
            </span>
            {(Object.keys(PRESET_LABEL) as Exclude<AccessPreset, 'custom'>[]).map((p) => (
              <button
                key={p}
                type="button"
                data-testid={`access-grants-preset-${p}`}
                aria-pressed={activePreset === p}
                onClick={() => applyPreset(p)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                  activePreset === p
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-100'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
            <button
              type="button"
              data-testid="access-grants-preset-clear"
              onClick={() => {
                setActivePreset('custom');
                setGridPreset((prev) => ({
                  permissions: [],
                  nonce: (prev?.nonce ?? 0) + 1,
                }));
              }}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-300"
            >
              Custom
            </button>
          </div>

          {catalog.loading && (
            <p className="text-[11px] text-slate-500">Reading schema objects…</p>
          )}

          <PermissionMatrix
            dialect={dialect}
            principal={accessPrincipal}
            action="grant"
            schema={defaultSchema || ''}
            catalog={catalog.objects}
            applyPreset={gridPreset}
            onChange={(reqs) => {
              setGridRequests(reqs);
              setActivePreset('custom');
            }}
          />

          {diff && diff.entries.length > 0 && (
            <ul className="space-y-1" data-testid="access-grants-diff">
              {diff.entries.slice(0, 12).map((e, i) => (
                <li
                  key={i}
                  className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                    STATUS_STYLE[e.status] ?? STATUS_STYLE.missing
                  }`}
                >
                  <span className="uppercase tracking-wide mr-1.5">{e.status}</span>
                  {e.label}
                </li>
              ))}
              {diff.entries.length > 12 && (
                <li className="text-[10px] text-slate-500 px-1">
                  +{diff.entries.length - 12} more
                </li>
              )}
            </ul>
          )}

          <div
            className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
            data-testid="access-grants-sql"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Grant SQL
              </h3>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-testid="access-grants-copy"
                  disabled={!sqlText.trim() || sqlText.startsWith('-- Desired')}
                  onClick={() => void navigator.clipboard.writeText(sqlText)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] font-bold text-slate-200 disabled:opacity-40"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <button
                  type="button"
                  data-testid="access-grants-open-sql"
                  disabled={!sqlText.trim() || sqlText.startsWith('-- Desired')}
                  onClick={openSql}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[11px] font-bold text-sky-100 disabled:opacity-40"
                >
                  <FileCode2 className="w-3 h-3" /> Open in SQL Editor
                </button>
              </div>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {sqlText.trim() || 'Tick objects and privileges to generate GRANT SQL.'}
            </pre>
            <p className="mt-2 text-[10px] text-slate-500">
              Fox Schema does not apply this SQL. The database stays the source of truth.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
