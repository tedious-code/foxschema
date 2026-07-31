/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared DBA utility probes for /schema/dba-utility.
 */
import {
  ConnectionFactory,
  buildDbaUtilityQuery,
  dialectSupportsDbaUtility,
  normalizeConnectionPoolRows,
  normalizeObjectSizeRows,
  normalizeSystemInfoRows,
  normalizeUserSessionRows,
  type ConnectionOptions,
  type ConnectionPoolInfo,
  type DbaUtilityKind,
  type DbaUtilitySupport,
  type ObjectSizeRow,
  type SystemInfoMetric,
  type UserSessionRow,
} from '@foxschema/core';

export type DbaUtilityProbeSuccess = {
  kind: DbaUtilityKind;
  mode: 'native' | 'estimated' | 'unsupported';
  support: DbaUtilitySupport;
  pool?: ConnectionPoolInfo;
  sessions?: UserSessionRow[];
  system?: SystemInfoMetric;
  sizes?: ObjectSizeRow[];
  warning?: string;
};

export type DbaUtilityProbeFailure = {
  error: string;
  support: DbaUtilitySupport;
  status: number;
};

export async function probeDbaUtility(opts: {
  dialect: string;
  option: ConnectionOptions;
  kind: DbaUtilityKind;
  schema?: string;
}): Promise<
  { ok: true; value: DbaUtilityProbeSuccess } | { ok: false; failure: DbaUtilityProbeFailure }
> {
  const support = dialectSupportsDbaUtility(opts.dialect, opts.kind);
  if (!support.query) {
    return {
      ok: false,
      failure: {
        status: 400,
        error: support.hint || 'This dialect does not support this utility.',
        support,
      },
    };
  }

  const built = buildDbaUtilityQuery({
    dialect: opts.dialect,
    kind: opts.kind,
    schema: opts.schema,
  });
  if ('error' in built) {
    return {
      ok: false,
      failure: { status: 400, error: built.error, support },
    };
  }

  try {
    const raw = await ConnectionFactory.executeQuery<Record<string, unknown>>(
      opts.dialect,
      opts.option,
      built.sql,
      built.params
    );

    const base = {
      kind: opts.kind,
      mode: built.mode,
      support,
    };

    if (opts.kind === 'pool') {
      return { ok: true, value: { ...base, pool: normalizeConnectionPoolRows(raw) } };
    }
    if (opts.kind === 'sessions') {
      return { ok: true, value: { ...base, sessions: normalizeUserSessionRows(raw) } };
    }
    if (opts.kind === 'system') {
      return { ok: true, value: { ...base, system: normalizeSystemInfoRows(raw) } };
    }
    return { ok: true, value: { ...base, sizes: normalizeObjectSizeRows(raw) } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'DBA utility probe failed';
    return {
      ok: false,
      failure: {
        status: 500,
        error: `${message} — ${support.hint}`,
        support,
      },
    };
  }
}
