/**
 * Shared index-fragmentation probe used by /schema/index-fragmentation
 * and the batch utility endpoint.
 */
import {
  ConnectionFactory,
  buildIndexDefragSql,
  buildIndexFragmentationCustomTemplate,
  buildIndexFragmentationQuery,
  dialectSupportsIndexFragmentation,
  isSafeIndexFragmentationCustomSql,
  normalizeIndexFragmentationRows,
  type ConnectionOptions,
  type IndexFragmentationRow,
  type IndexFragmentationSupport,
} from '@foxschema/db';

export type FragProbeResult = {
  rows: IndexFragmentationRow[];
  source: 'default' | 'custom';
  mode: 'physical' | 'estimated' | 'unsupported';
  support: IndexFragmentationSupport;
  defrag: Record<string, string[]>;
  customSqlTemplate: string;
  warning?: string;
};

export type FragProbeFailure = {
  error: string;
  support: IndexFragmentationSupport;
  customSqlTemplate: string;
  defaultFailed?: boolean;
  status: number;
};

/**
 * Dialects that key catalog probes by database/owner often store that name on
 * `option.database` (MySQL family) or `option.username` (Oracle) while the
 * saved connection `schema` field is left blank. Schema load already falls
 * back; fragmentation must too or Utilities shows empty % while Edit Table
 * can still look fine when schema was typed once / defaulted elsewhere.
 */
export function resolveFragmentationSchema(
  dialect: string,
  schema: string | undefined,
  option: ConnectionOptions
): string {
  const explicit = (schema ?? '').trim();
  if (explicit) return explicit;
  const d = dialect.toLowerCase();
  if (d === 'mysql' || d === 'mariadb' || d === 'tidb') {
    return String(option.database || option.schema || '').trim();
  }
  if (d === 'oracle') {
    return String(option.schema || option.username || '').trim();
  }
  if (d === 'db2') {
    return String(option.schema || '').trim();
  }
  return '';
}

async function runProbe(
  dialect: string,
  option: ConnectionOptions,
  schema: string,
  table: string,
  sql: string,
  params: unknown[],
  source: 'default' | 'custom',
  mode: 'physical' | 'estimated' | 'unsupported',
  support: IndexFragmentationSupport,
  customTemplate: string
): Promise<FragProbeResult> {
  const raw = await ConnectionFactory.executeQuery<Record<string, unknown>>(
    dialect,
    option,
    sql,
    params
  );
  const rows = normalizeIndexFragmentationRows(raw);
  const defrag: Record<string, string[]> = {};
  for (const row of rows) {
    const stmts = buildIndexDefragSql({
      dialect,
      schema,
      table,
      indexName: row.indexName,
      fragmentationPercent: row.fragmentationPercent,
    });
    if (stmts.length) defrag[row.indexName] = stmts;
  }
  return {
    rows,
    source,
    mode: source === 'custom' ? 'estimated' : mode,
    support,
    defrag,
    customSqlTemplate: customTemplate,
  };
}

/**
 * Probe one table. Returns either a result or a structured failure
 * (caller maps `status` onto the HTTP response).
 */
export async function probeTableFragmentation(opts: {
  dialect: string;
  option: ConnectionOptions;
  schema: string;
  table: string;
  customSql?: string;
  preferCustom?: boolean;
}): Promise<{ ok: true; value: FragProbeResult } | { ok: false; failure: FragProbeFailure }> {
  const { dialect, option, table } = opts;
  const schema = resolveFragmentationSchema(dialect, opts.schema, option);
  const customSql = (opts.customSql ?? '').trim();
  const preferCustom = opts.preferCustom === true;
  const support = dialectSupportsIndexFragmentation(dialect);
  const customTemplate = buildIndexFragmentationCustomTemplate({ dialect, schema, table });

  if (preferCustom || (!support.query && customSql)) {
    if (!customSql) {
      return {
        ok: false,
        failure: {
          status: 400,
          error: support.query
            ? 'customSql is required when preferCustom is set.'
            : support.hint,
          support,
          customSqlTemplate: customTemplate,
        },
      };
    }
    const safe = isSafeIndexFragmentationCustomSql(customSql);
    if (safe !== true) {
      return {
        ok: false,
        failure: {
          status: 400,
          error: safe,
          support,
          customSqlTemplate: customTemplate,
        },
      };
    }
    try {
      const value = await runProbe(
        dialect,
        option,
        schema,
        table,
        customSql.replace(/;+\s*$/, ''),
        [],
        'custom',
        support.mode,
        support,
        customTemplate
      );
      return { ok: true, value };
    } catch (err: unknown) {
      return {
        ok: false,
        failure: {
          status: 500,
          error: err instanceof Error ? err.message : 'Custom fragmentation query failed',
          support,
          customSqlTemplate: customTemplate,
        },
      };
    }
  }

  const built = buildIndexFragmentationQuery({ dialect, schema, table });
  if ('error' in built) {
    if (customSql) {
      const safe = isSafeIndexFragmentationCustomSql(customSql);
      if (safe !== true) {
        return {
          ok: false,
          failure: {
            status: 400,
            error: `${built.error} Custom SQL rejected: ${safe}`,
            support,
            customSqlTemplate: customTemplate,
          },
        };
      }
      try {
        const value = await runProbe(
          dialect,
          option,
          schema,
          table,
          customSql.replace(/;+\s*$/, ''),
          [],
          'custom',
          support.mode,
          support,
          customTemplate
        );
        return { ok: true, value: { ...value, warning: built.error } };
      } catch (err: unknown) {
        return {
          ok: false,
          failure: {
            status: 500,
            error: err instanceof Error ? err.message : 'Custom fragmentation query failed',
            support,
            customSqlTemplate: customTemplate,
          },
        };
      }
    }
    return {
      ok: false,
      failure: {
        status: 400,
        error: built.error,
        support,
        customSqlTemplate: customTemplate,
      },
    };
  }

  try {
    const value = await runProbe(
      dialect,
      option,
      schema,
      table,
      built.sql,
      built.params,
      'default',
      built.mode,
      support,
      customTemplate
    );
    return { ok: true, value };
  } catch (defaultErr: unknown) {
    const defaultMessage =
      defaultErr instanceof Error ? defaultErr.message : 'Default fragmentation query failed';
    if (!customSql) {
      return {
        ok: false,
        failure: {
          status: 500,
          error: defaultMessage,
          support,
          customSqlTemplate: customTemplate,
          defaultFailed: true,
        },
      };
    }
    const safe = isSafeIndexFragmentationCustomSql(customSql);
    if (safe !== true) {
      return {
        ok: false,
        failure: {
          status: 400,
          error: `Default probe failed (${defaultMessage}). Custom SQL rejected: ${safe}`,
          support,
          customSqlTemplate: customTemplate,
          defaultFailed: true,
        },
      };
    }
    try {
      const value = await runProbe(
        dialect,
        option,
        schema,
        table,
        customSql.replace(/;+\s*$/, ''),
        [],
        'custom',
        support.mode,
        support,
        customTemplate
      );
      return {
        ok: true,
        value: {
          ...value,
          warning: `Default probe failed (${defaultMessage}); used custom SQL.`,
        },
      };
    } catch (customErr: unknown) {
      const customMessage =
        customErr instanceof Error ? customErr.message : 'Custom fragmentation query failed';
      return {
        ok: false,
        failure: {
          status: 500,
          error: `Default probe failed (${defaultMessage}). Custom SQL failed (${customMessage}).`,
          support,
          customSqlTemplate: customTemplate,
          defaultFailed: true,
        },
      };
    }
  }
}

/** Run async work with a fixed concurrency pool. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return out;
}
