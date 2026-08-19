/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dialect-aware DBA utility probes for SQL Editor → Utilities:
 * - connection pool / server connection limits
 * - active user sessions
 * - system info (RAM / storage / CPU where the engine exposes it)
 * - table and index sizes
 *
 * Quality ladder mirrors index fragmentation: native DMV/catalog when available,
 * estimated otherwise, unsupported with a hint for embedded engines.
 */

export type DbaProbeMode = 'native' | 'estimated' | 'unsupported';

export type DbaUtilityKind = 'pool' | 'sessions' | 'system' | 'sizes';

export interface DbaUtilitySupport {
  mode: DbaProbeMode;
  query: boolean;
  hint: string;
}

export interface DbaUtilityQuery {
  sql: string;
  params: unknown[];
  mode: Exclude<DbaProbeMode, 'unsupported'>;
}

export interface ConnectionPoolInfo {
  maxConnections: number | null;
  currentConnections: number | null;
  activeConnections: number | null;
  availableConnections: number | null;
  waitCount: number | null;
  details: Array<{ key: string; value: string }>;
}

export interface UserSessionRow {
  sessionId: string;
  userName: string | null;
  clientHost: string | null;
  databaseName: string | null;
  state: string | null;
  waitEvent: string | null;
  queryText: string | null;
  connectedAt: string | null;
  applicationName: string | null;
}

export interface SystemInfoMetric {
  cpuCount: number | null;
  cpuUsagePercent: number | null;
  memoryTotalBytes: number | null;
  memoryUsedBytes: number | null;
  memoryAvailableBytes: number | null;
  storageTotalBytes: number | null;
  storageUsedBytes: number | null;
  storageAvailableBytes: number | null;
  uptimeSeconds: number | null;
  serverVersion: string | null;
  details: Array<{ key: string; value: string }>;
}

export interface ObjectSizeRow {
  schemaName: string | null;
  objectName: string;
  objectType: 'table' | 'index' | 'other';
  tableName: string | null;
  totalBytes: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
  rowCount: number | null;
}

const UNSUPPORTED: DbaUtilitySupport = {
  mode: 'unsupported',
  query: false,
  hint: 'This dialect does not expose a built-in probe for this utility.',
};

function family(dialect: string): string {
  const d = (dialect || '').toLowerCase();
  if (d === 'azuresql') return 'sqlserver';
  /**
   * MariaDB is its own family here, not a MySQL alias.
   *
   * Two of these probes are wrong on it. `@@innodb_buffer_pool_instances` was
   * removed in MariaDB 10.5, so System info died on `Unknown system variable`
   * before returning anything. And `performance_schema` is off by default, so
   * the status lookups the pool probe leans on came back *empty* — no error, a
   * blank connection count, which is worse. MariaDB keeps the same figures in
   * `information_schema.GLOBAL_STATUS`.
   */
  if (d === 'mariadb') return 'mariadb';
  if (d === 'tidb') return 'mysql';
  if (d === 'cockroachdb' || d === 'yugabytedb') return 'postgres';
  return d;
}

function supportMap(
  kind: DbaUtilityKind
): Record<string, DbaUtilitySupport> {
  const pg: DbaUtilitySupport = {
    mode: kind === 'system' ? 'estimated' : 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'PostgreSQL exposes DB size and memory settings; host CPU/RAM need OS access or extensions.'
        : kind === 'pool'
          ? 'PostgreSQL: max_connections vs pg_stat_activity counts.'
          : kind === 'sessions'
            ? 'PostgreSQL: pg_stat_activity.'
            : 'PostgreSQL: pg_total_relation_size / pg_indexes_size.',
  };
  const mysql: DbaUtilitySupport = {
    mode: kind === 'system' ? 'estimated' : 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'MySQL: status/variables (buffer pool, uptime). Host disk/CPU are limited.'
        : kind === 'pool'
          ? 'MySQL: max_connections, Threads_connected, Threads_running.'
          : kind === 'sessions'
            ? 'MySQL: information_schema.PROCESSLIST.'
            : 'MySQL: information_schema.TABLES DATA_LENGTH / INDEX_LENGTH.',
  };
  const mssql: DbaUtilitySupport = {
    mode: 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'SQL Server: sys.dm_os_sys_info / performance counters.'
        : kind === 'pool'
          ? 'SQL Server: @@MAX_CONNECTIONS and session counts.'
          : kind === 'sessions'
            ? 'SQL Server: sys.dm_exec_sessions / requests.'
            : 'SQL Server: partition stats + index sizes.',
  };
  const oracle: DbaUtilitySupport = {
    mode: kind === 'system' ? 'estimated' : 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'Oracle: v$osstat / v$sga when permitted; otherwise session/SGA estimates.'
        : kind === 'pool'
          ? 'Oracle: sessions / processes from v$parameter + v$session.'
          : kind === 'sessions'
            ? 'Oracle: v$session.'
            : 'Oracle: user_segments / all_segments sizes.',
  };
  const db2: DbaUtilitySupport = {
    mode: kind === 'system' ? 'estimated' : 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'DB2: ENV_GET_SYSTEM_RESOURCES / snapshot when available.'
        : kind === 'pool'
          ? 'DB2: MAXAPPLS and application counts.'
          : kind === 'sessions'
            ? 'DB2: MON_GET_CONNECTION / SYSIBMADM.APPLICATIONS.'
            : 'DB2: SYSCAT.TABLES FPAGES + SYSCAT.INDEXES NLEAF × tablespace page size.',
  };
  const sqlite: DbaUtilitySupport = {
    mode: kind === 'sizes' || kind === 'system' ? 'estimated' : 'unsupported',
    query: kind === 'sizes' || kind === 'system',
    hint:
      kind === 'sizes'
        ? 'SQLite: dbstat / page_count × page_size.'
        : kind === 'system'
          ? 'SQLite: database file page_count × page_size (storage only).'
          : 'SQLite is embedded — no server connection pool or multi-user sessions.',
  };
  const duckdb: DbaUtilitySupport = {
    mode: kind === 'sizes' ? 'estimated' : 'unsupported',
    query: kind === 'sizes',
    hint:
      kind === 'sizes'
        ? 'DuckDB: pragma_database_size / table estimates when available.'
        : 'DuckDB is embedded — no server pool/sessions/system DMVs.',
  };
  const clickhouse: DbaUtilitySupport = {
    mode: kind === 'system' ? 'estimated' : 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'ClickHouse: system.asynchronous_metrics / metrics (partial).'
        : kind === 'pool'
          ? 'ClickHouse: max_concurrent_queries and current query counts.'
          : kind === 'sessions'
            ? 'ClickHouse: system.processes.'
            : 'ClickHouse: system.parts sizes.',
  };
  const redshift: DbaUtilitySupport = {
    mode: kind === 'system' ? 'estimated' : 'native',
    query: true,
    hint:
      kind === 'system'
        ? 'Redshift: limited cluster metrics via SVV / STL views.'
        : kind === 'pool'
          ? 'Redshift: max_connections and stv_sessions counts.'
          : kind === 'sessions'
            ? 'Redshift: stv_sessions / pg_stat_activity.'
            : 'Redshift: svv_table_info sizes.',
  };

  return {
    postgres: pg,
    cockroachdb: { ...pg, mode: 'estimated', hint: `${pg.hint} (CockroachDB may differ).` },
    yugabytedb: { ...pg, mode: 'estimated', hint: `${pg.hint} (YugabyteDB may differ).` },
    mysql,
    mariadb: { ...mysql, hint: mysql.hint.replace('MySQL', 'MariaDB') },
    tidb: { ...mysql, mode: 'estimated', hint: mysql.hint.replace('MySQL', 'TiDB') },
    sqlserver: mssql,
    azuresql: { ...mssql, hint: mssql.hint.replace('SQL Server', 'Azure SQL') },
    oracle,
    db2,
    sqlite,
    duckdb,
    clickhouse,
    redshift,
  };
}

export function dialectSupportsDbaUtility(
  dialect: string,
  kind: DbaUtilityKind
): DbaUtilitySupport {
  const map = supportMap(kind);
  return map[(dialect || '').toLowerCase()] ?? UNSUPPORTED;
}

export function buildDbaUtilityQuery(opts: {
  dialect: string;
  kind: DbaUtilityKind;
  schema?: string;
}): DbaUtilityQuery | { error: string } {
  const support = dialectSupportsDbaUtility(opts.dialect, opts.kind);
  if (!support.query) {
    return { error: support.hint || 'Unsupported dialect for this utility.' };
  }
  const f = family(opts.dialect);
  const schema = (opts.schema || '').trim();

  switch (opts.kind) {
    case 'pool':
      return buildPoolQuery(f, support.mode === 'unsupported' ? 'estimated' : support.mode);
    case 'sessions':
      return buildSessionsQuery(f, support.mode === 'unsupported' ? 'estimated' : support.mode);
    case 'system':
      return buildSystemQuery(f, support.mode === 'unsupported' ? 'estimated' : support.mode);
    case 'sizes':
      return buildSizesQuery(
        f,
        schema,
        support.mode === 'unsupported' ? 'estimated' : support.mode
      );
    default:
      return { error: 'Unknown utility kind.' };
  }
}

function asMode(mode: DbaProbeMode): Exclude<DbaProbeMode, 'unsupported'> {
  return mode === 'native' ? 'native' : 'estimated';
}

function buildPoolQuery(
  f: string,
  mode: Exclude<DbaProbeMode, 'unsupported'>
): DbaUtilityQuery | { error: string } {
  if (f === 'postgres') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  (SELECT count(*)::int FROM pg_stat_activity) AS current_connections,
  (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active') AS active_connections,
  (SELECT count(*)::int FROM pg_stat_activity WHERE wait_event IS NOT NULL) AS wait_count,
  (SELECT setting FROM pg_settings WHERE name = 'superuser_reserved_connections') AS superuser_reserved
`.trim(),
    };
  }
  if (f === 'mysql') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(@@max_connections AS SIGNED) AS max_connections,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected' LIMIT 1) AS current_connections,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_running' LIMIT 1) AS active_connections,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_cached' LIMIT 1) AS available_connections,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Connection_errors_max_connections' LIMIT 1) AS wait_count
`.trim(),
    };
  }
  if (f === 'mariadb') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(@@max_connections AS SIGNED) AS max_connections,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Threads_connected' LIMIT 1) AS current_connections,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Threads_running' LIMIT 1) AS active_connections,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Threads_cached' LIMIT 1) AS available_connections,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Connection_errors_max_connections' LIMIT 1) AS wait_count
`.trim(),
    };
  }
  if (f === 'sqlserver') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(@@MAX_CONNECTIONS AS int) AS max_connections,
  (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS current_connections,
  (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id > 50) AS active_connections,
  (SELECT COUNT(*) FROM sys.dm_os_waiting_tasks) AS wait_count
`.trim(),
    };
  }
  if (f === 'oracle') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  (SELECT TO_NUMBER(value) FROM v$parameter WHERE name = 'sessions') AS max_connections,
  (SELECT COUNT(*) FROM v$session) AS current_connections,
  (SELECT COUNT(*) FROM v$session WHERE status = 'ACTIVE') AS active_connections,
  (SELECT COUNT(*) FROM v$session_wait WHERE state = 'WAITING') AS wait_count
FROM dual
`.trim(),
    };
  }
  if (f === 'db2') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  (SELECT CAST(VALUE AS INTEGER) FROM SYSIBMADM.DBCFG WHERE NAME = 'maxappls' FETCH FIRST 1 ROW ONLY) AS max_connections,
  (SELECT COUNT(*) FROM TABLE(MON_GET_CONNECTION(NULL, -2))) AS current_connections,
  (SELECT COUNT(*) FROM TABLE(MON_GET_CONNECTION(NULL, -2)) WHERE APPLICATION_HANDLE IS NOT NULL) AS active_connections
FROM SYSIBM.SYSDUMMY1
`.trim(),
    };
  }
  if (f === 'clickhouse') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  toInt64OrNull((SELECT value FROM system.settings WHERE name = 'max_concurrent_queries' LIMIT 1)) AS max_connections,
  (SELECT count() FROM system.processes) AS current_connections,
  (SELECT count() FROM system.processes WHERE is_cancelled = 0) AS active_connections
`.trim(),
    };
  }
  if (f === 'redshift') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  (SELECT count(*)::int FROM stv_sessions) AS current_connections,
  (SELECT count(*)::int FROM stv_recents WHERE status = 'Running') AS active_connections
`.trim(),
    };
  }
  return { error: 'No connection-pool probe for this dialect.' };
}

function buildSessionsQuery(
  f: string,
  mode: Exclude<DbaProbeMode, 'unsupported'>
): DbaUtilityQuery | { error: string } {
  if (f === 'postgres') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  pid::text AS session_id,
  usename AS user_name,
  client_addr::text AS client_host,
  datname AS database_name,
  state,
  COALESCE(wait_event_type || ':' || wait_event, wait_event) AS wait_event,
  LEFT(query, 500) AS query_text,
  backend_start::text AS connected_at,
  application_name
FROM pg_stat_activity
WHERE backend_type = 'client backend' OR backend_type IS NULL
ORDER BY backend_start DESC NULLS LAST
LIMIT 500
`.trim(),
    };
  }
  if (f === 'mysql' || f === 'mariadb') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(ID AS CHAR) AS session_id,
  USER AS user_name,
  HOST AS client_host,
  DB AS database_name,
  COMMAND AS state,
  STATE AS wait_event,
  LEFT(INFO, 500) AS query_text,
  NULL AS connected_at,
  NULL AS application_name
FROM information_schema.PROCESSLIST
ORDER BY ID
LIMIT 500
`.trim(),
    };
  }
  if (f === 'sqlserver') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT TOP 500
  CAST(s.session_id AS varchar(32)) AS session_id,
  s.login_name AS user_name,
  s.host_name AS client_host,
  DB_NAME(s.database_id) AS database_name,
  s.status AS state,
  r.wait_type AS wait_event,
  LEFT(t.text, 500) AS query_text,
  CONVERT(varchar(33), s.login_time, 126) AS connected_at,
  s.program_name AS application_name
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE s.is_user_process = 1
ORDER BY s.login_time DESC
`.trim(),
    };
  }
  if (f === 'oracle') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT * FROM (
  SELECT
    TO_CHAR(sid) AS session_id,
    username AS user_name,
    machine AS client_host,
    COALESCE(service_name, schemaname) AS database_name,
    status AS state,
    event AS wait_event,
    SUBSTR(sql_id, 1, 500) AS query_text,
    TO_CHAR(logon_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS connected_at,
    program AS application_name
  FROM v$session
  WHERE type = 'USER'
  ORDER BY logon_time DESC NULLS LAST
) WHERE ROWNUM <= 500
`.trim(),
    };
  }
  if (f === 'db2') {
    // `database_name` is CURRENT SERVER, not a partition column. The original
    // query selected a partition number here under a column name that promised
    // the database — and picked one MON_GET_CONNECTION does not expose, so DB2
    // answered SQL0206N and Sessions failed outright for every DB2 user.
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(APPLICATION_HANDLE AS VARCHAR(32)) AS session_id,
  SESSION_AUTH_ID AS user_name,
  CLIENT_HOSTNAME AS client_host,
  CURRENT SERVER AS database_name,
  APPLICATION_NAME AS state,
  CAST(NULL AS VARCHAR(128)) AS wait_event,
  CAST(NULL AS VARCHAR(500)) AS query_text,
  CAST(CONNECTION_START_TIME AS VARCHAR(40)) AS connected_at,
  APPLICATION_NAME AS application_name
FROM TABLE(MON_GET_CONNECTION(NULL, -2))
FETCH FIRST 500 ROWS ONLY
`.trim(),
    };
  }
  if (f === 'clickhouse') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  toString(query_id) AS session_id,
  user AS user_name,
  client_hostname AS client_host,
  current_database AS database_name,
  if(is_cancelled = 1, 'cancelled', 'running') AS state,
  '' AS wait_event,
  substring(query, 1, 500) AS query_text,
  toString(elapsed) AS connected_at,
  '' AS application_name
FROM system.processes
LIMIT 500
`.trim(),
    };
  }
  if (f === 'redshift') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  process::text AS session_id,
  user_name,
  remotehost AS client_host,
  db_name AS database_name,
  'connected' AS state,
  NULL AS wait_event,
  NULL AS query_text,
  starttime::text AS connected_at,
  NULL AS application_name
FROM stv_sessions
ORDER BY starttime DESC
LIMIT 500
`.trim(),
    };
  }
  return { error: 'No user-sessions probe for this dialect.' };
}

function buildSystemQuery(
  f: string,
  mode: Exclude<DbaProbeMode, 'unsupported'>
): DbaUtilityQuery | { error: string } {
  if (f === 'sqlserver') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  i.cpu_count AS cpu_count,
  NULL AS cpu_usage_percent,
  i.physical_memory_kb * 1024 AS memory_total_bytes,
  (i.physical_memory_kb - m.available_physical_memory_kb) * 1024 AS memory_used_bytes,
  m.available_physical_memory_kb * 1024 AS memory_available_bytes,
  NULL AS storage_total_bytes,
  (SELECT SUM(size) * 8 * 1024 FROM sys.database_files) AS storage_used_bytes,
  NULL AS storage_available_bytes,
  datediff_big(second, i.sqlserver_start_time, sysdatetime()) AS uptime_seconds,
  @@VERSION AS server_version
FROM sys.dm_os_sys_info i
CROSS JOIN sys.dm_os_sys_memory m
`.trim(),
    };
  }
  if (f === 'postgres') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  NULL::int AS cpu_count,
  NULL::float8 AS cpu_usage_percent,
  (SELECT setting::bigint * CASE unit WHEN '8kB' THEN 8192 WHEN 'kB' THEN 1024 ELSE 1 END
     FROM pg_settings WHERE name = 'shared_buffers') AS memory_total_bytes,
  NULL::bigint AS memory_used_bytes,
  NULL::bigint AS memory_available_bytes,
  NULL::bigint AS storage_total_bytes,
  pg_database_size(current_database()) AS storage_used_bytes,
  NULL::bigint AS storage_available_bytes,
  EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds,
  version() AS server_version
`.trim(),
    };
  }
  if (f === 'mariadb') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  NULL AS cpu_count,
  NULL AS cpu_usage_percent,
  CAST(@@innodb_buffer_pool_size AS SIGNED) AS memory_total_bytes,
  NULL AS memory_used_bytes,
  NULL AS memory_available_bytes,
  NULL AS storage_total_bytes,
  (SELECT SUM(DATA_LENGTH + INDEX_LENGTH) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) AS storage_used_bytes,
  NULL AS storage_available_bytes,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Uptime' LIMIT 1) AS uptime_seconds,
  VERSION() AS server_version
`.trim(),
    };
  }
  if (f === 'mysql') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(@@innodb_buffer_pool_instances AS SIGNED) AS cpu_count,
  NULL AS cpu_usage_percent,
  CAST(@@innodb_buffer_pool_size AS SIGNED) AS memory_total_bytes,
  NULL AS memory_used_bytes,
  NULL AS memory_available_bytes,
  NULL AS storage_total_bytes,
  (SELECT SUM(DATA_LENGTH + INDEX_LENGTH) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) AS storage_used_bytes,
  NULL AS storage_available_bytes,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime' LIMIT 1) AS uptime_seconds,
  VERSION() AS server_version
`.trim(),
    };
  }
  if (f === 'oracle') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  (SELECT value FROM v$osstat WHERE stat_name = 'NUM_CPUS') AS cpu_count,
  NULL AS cpu_usage_percent,
  (SELECT value FROM v$osstat WHERE stat_name = 'PHYSICAL_MEMORY_BYTES') AS memory_total_bytes,
  NULL AS memory_used_bytes,
  NULL AS memory_available_bytes,
  NULL AS storage_total_bytes,
  (SELECT SUM(bytes) FROM user_segments) AS storage_used_bytes,
  NULL AS storage_available_bytes,
  NULL AS uptime_seconds,
  (SELECT banner FROM v$version WHERE banner LIKE 'Oracle%' AND ROWNUM = 1) AS server_version
FROM dual
`.trim(),
    };
  }
  if (f === 'db2') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  CAST(NULL AS INTEGER) AS cpu_count,
  CAST(NULL AS DOUBLE) AS cpu_usage_percent,
  CAST(NULL AS BIGINT) AS memory_total_bytes,
  CAST(NULL AS BIGINT) AS memory_used_bytes,
  CAST(NULL AS BIGINT) AS memory_available_bytes,
  CAST(NULL AS BIGINT) AS storage_total_bytes,
  CAST(NULL AS BIGINT) AS storage_used_bytes,
  CAST(NULL AS BIGINT) AS storage_available_bytes,
  CAST(NULL AS BIGINT) AS uptime_seconds,
  (SELECT SERVICE_LEVEL FROM TABLE(SYSPROC.ENV_GET_INST_INFO()) FETCH FIRST 1 ROW ONLY) AS server_version
FROM SYSIBM.SYSDUMMY1
`.trim(),
    };
  }
  if (f === 'sqlite') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  NULL AS cpu_count,
  NULL AS cpu_usage_percent,
  NULL AS memory_total_bytes,
  NULL AS memory_used_bytes,
  NULL AS memory_available_bytes,
  NULL AS storage_total_bytes,
  (SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) AS storage_used_bytes,
  NULL AS storage_available_bytes,
  NULL AS uptime_seconds,
  sqlite_version() AS server_version
`.trim(),
    };
  }
  if (f === 'clickhouse') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  toInt64OrNull((SELECT value FROM system.asynchronous_metrics WHERE metric = 'NumberOfProcessors' LIMIT 1)) AS cpu_count,
  toFloat64OrNull((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSCPUUtilization' LIMIT 1)) AS cpu_usage_percent,
  toInt64OrNull((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1)) AS memory_total_bytes,
  toInt64OrNull((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryAvailable' LIMIT 1)) AS memory_available_bytes,
  NULL AS memory_used_bytes,
  NULL AS storage_total_bytes,
  toInt64OrNull((SELECT value FROM system.asynchronous_metrics WHERE metric = 'DiskUsed_default' LIMIT 1)) AS storage_used_bytes,
  NULL AS storage_available_bytes,
  toInt64OrNull((SELECT value FROM system.metrics WHERE metric = 'Uptime' LIMIT 1)) AS uptime_seconds,
  version() AS server_version
`.trim(),
    };
  }
  if (f === 'redshift') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  NULL::int AS cpu_count,
  NULL::float8 AS cpu_usage_percent,
  NULL::bigint AS memory_total_bytes,
  NULL::bigint AS memory_used_bytes,
  NULL::bigint AS memory_available_bytes,
  NULL::bigint AS storage_total_bytes,
  (SELECT sum(size)::bigint * 1024 * 1024 FROM stv_partitions) AS storage_used_bytes,
  NULL::bigint AS storage_available_bytes,
  NULL::bigint AS uptime_seconds,
  version() AS server_version
`.trim(),
    };
  }
  return { error: 'No system-info probe for this dialect.' };
}

function buildSizesQuery(
  f: string,
  schema: string,
  mode: Exclude<DbaProbeMode, 'unsupported'>
): DbaUtilityQuery | { error: string } {
  if (f === 'postgres') {
    return {
      mode: asMode(mode),
      params: schema ? [schema] : [],
      sql: schema
        ? `
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'i' THEN 'index' ELSE 'other' END AS object_type,
  COALESCE(t.relname, c.relname) AS table_name,
  pg_total_relation_size(c.oid) AS total_bytes,
  CASE WHEN c.relkind IN ('r','p') THEN pg_relation_size(c.oid) ELSE NULL END AS data_bytes,
  CASE WHEN c.relkind IN ('r','p') THEN pg_indexes_size(c.oid) WHEN c.relkind = 'i' THEN pg_relation_size(c.oid) ELSE NULL END AS index_bytes,
  c.reltuples::bigint AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_index i ON i.indexrelid = c.oid
LEFT JOIN pg_class t ON t.oid = i.indrelid
WHERE n.nspname = $1
  AND c.relkind IN ('r','p','i','m')
ORDER BY pg_total_relation_size(c.oid) DESC NULLS LAST
LIMIT 1000
`.trim()
        : `
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'i' THEN 'index' ELSE 'other' END AS object_type,
  COALESCE(t.relname, c.relname) AS table_name,
  pg_total_relation_size(c.oid) AS total_bytes,
  CASE WHEN c.relkind IN ('r','p') THEN pg_relation_size(c.oid) ELSE NULL END AS data_bytes,
  CASE WHEN c.relkind IN ('r','p') THEN pg_indexes_size(c.oid) WHEN c.relkind = 'i' THEN pg_relation_size(c.oid) ELSE NULL END AS index_bytes,
  c.reltuples::bigint AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_index i ON i.indexrelid = c.oid
LEFT JOIN pg_class t ON t.oid = i.indrelid
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND c.relkind IN ('r','p','i','m')
ORDER BY pg_total_relation_size(c.oid) DESC NULLS LAST
LIMIT 1000
`.trim(),
    };
  }
  if (f === 'mysql' || f === 'mariadb') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  TABLE_SCHEMA AS schema_name,
  TABLE_NAME AS object_name,
  'table' AS object_type,
  TABLE_NAME AS table_name,
  (DATA_LENGTH + INDEX_LENGTH) AS total_bytes,
  DATA_LENGTH AS data_bytes,
  INDEX_LENGTH AS index_bytes,
  TABLE_ROWS AS row_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
LIMIT 1000
`.trim(),
    };
  }
  if (f === 'sqlserver') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT TOP 1000
  OBJECT_SCHEMA_NAME(i.object_id) AS schema_name,
  i.name AS object_name,
  CASE WHEN i.index_id <= 1 THEN 'table' ELSE 'index' END AS object_type,
  OBJECT_NAME(i.object_id) AS table_name,
  SUM(ps.used_page_count) * 8 * 1024 AS total_bytes,
  SUM(CASE WHEN i.index_id IN (0,1) THEN ps.used_page_count ELSE 0 END) * 8 * 1024 AS data_bytes,
  SUM(CASE WHEN i.index_id > 1 THEN ps.used_page_count ELSE 0 END) * 8 * 1024 AS index_bytes,
  SUM(ps.row_count) AS row_count
FROM sys.dm_db_partition_stats ps
JOIN sys.indexes i ON i.object_id = ps.object_id AND i.index_id = ps.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
GROUP BY i.object_id, i.name, i.index_id
ORDER BY SUM(ps.used_page_count) DESC
`.trim(),
    };
  }
  if (f === 'oracle') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT * FROM (
  SELECT
    tablespace_name AS schema_name,
    segment_name AS object_name,
    CASE WHEN segment_type LIKE 'TABLE%' THEN 'table' WHEN segment_type LIKE 'INDEX%' THEN 'index' ELSE 'other' END AS object_type,
    CASE WHEN segment_type LIKE 'INDEX%' THEN NULL ELSE segment_name END AS table_name,
    bytes AS total_bytes,
    CASE WHEN segment_type LIKE 'TABLE%' THEN bytes ELSE NULL END AS data_bytes,
    CASE WHEN segment_type LIKE 'INDEX%' THEN bytes ELSE NULL END AS index_bytes,
    NULL AS row_count
  FROM user_segments
  WHERE segment_type LIKE 'TABLE%' OR segment_type LIKE 'INDEX%'
  ORDER BY bytes DESC NULLS LAST
) WHERE ROWNUM <= 1000
`.trim(),
    };
  }
  if (f === 'db2') {
    // FPAGES = allocated pages (use for data). NPAGES can be lower and must not
    // be used as "total" or Total < Data. Index leaf pages from SYSCAT.INDEXES.
    // Page size from the table's tablespace when available.
    const tableSelect = `
SELECT
  t.TABSCHEMA AS schema_name,
  t.TABNAME AS object_name,
  'table' AS object_type,
  t.TABNAME AS table_name,
  BIGINT(COALESCE(t.FPAGES, t.NPAGES, 0) + COALESCE(i.index_pages, 0))
    * BIGINT(COALESCE(ts.PAGESIZE, 4096)) AS total_bytes,
  BIGINT(COALESCE(t.FPAGES, t.NPAGES, 0))
    * BIGINT(COALESCE(ts.PAGESIZE, 4096)) AS data_bytes,
  BIGINT(COALESCE(i.index_pages, 0))
    * BIGINT(COALESCE(ts.PAGESIZE, 4096)) AS index_bytes,
  t.CARD AS row_count
FROM SYSCAT.TABLES t
LEFT JOIN SYSCAT.TABLESPACES ts ON ts.TBSPACE = t.TBSPACE
LEFT JOIN (
  SELECT TABSCHEMA, TABNAME, SUM(BIGINT(COALESCE(NLEAF, 0))) AS index_pages
  FROM SYSCAT.INDEXES
  GROUP BY TABSCHEMA, TABNAME
) i ON i.TABSCHEMA = t.TABSCHEMA AND i.TABNAME = t.TABNAME
WHERE t.TYPE = 'T'`.trim();
    const indexSelect = `
SELECT
  ix.TABSCHEMA AS schema_name,
  ix.INDNAME AS object_name,
  'index' AS object_type,
  ix.TABNAME AS table_name,
  BIGINT(COALESCE(ix.NLEAF, 0)) * BIGINT(COALESCE(ts.PAGESIZE, 4096)) AS total_bytes,
  CAST(NULL AS BIGINT) AS data_bytes,
  BIGINT(COALESCE(ix.NLEAF, 0)) * BIGINT(COALESCE(ts.PAGESIZE, 4096)) AS index_bytes,
  CAST(NULL AS BIGINT) AS row_count
FROM SYSCAT.INDEXES ix
JOIN SYSCAT.TABLES t ON t.TABSCHEMA = ix.TABSCHEMA AND t.TABNAME = ix.TABNAME AND t.TYPE = 'T'
LEFT JOIN SYSCAT.TABLESPACES ts ON ts.TBSPACE = t.TBSPACE`.trim();
    return {
      mode: asMode(mode),
      params: schema ? [schema.toUpperCase(), schema.toUpperCase()] : [],
      sql: schema
        ? `
SELECT * FROM (
  ${tableSelect}
    AND t.TABSCHEMA = ?
  UNION ALL
  ${indexSelect}
    AND ix.TABSCHEMA = ?
) u
ORDER BY COALESCE(total_bytes, 0) DESC
FETCH FIRST 1000 ROWS ONLY
`.trim()
        : `
SELECT * FROM (
  ${tableSelect}
    AND t.TABSCHEMA NOT LIKE 'SYS%'
  UNION ALL
  ${indexSelect}
    AND ix.TABSCHEMA NOT LIKE 'SYS%'
) u
ORDER BY COALESCE(total_bytes, 0) DESC
FETCH FIRST 1000 ROWS ONLY
`.trim(),
    };
  }
  if (f === 'sqlite') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  NULL AS schema_name,
  name AS object_name,
  CASE WHEN type = 'table' THEN 'table' WHEN type = 'index' THEN 'index' ELSE 'other' END AS object_type,
  CASE WHEN type = 'index' THEN tbl_name ELSE name END AS table_name,
  (SELECT SUM(pgsize) FROM dbstat WHERE name = m.name) AS total_bytes,
  CASE WHEN type = 'table' THEN (SELECT SUM(pgsize) FROM dbstat WHERE name = m.name) ELSE NULL END AS data_bytes,
  CASE WHEN type = 'index' THEN (SELECT SUM(pgsize) FROM dbstat WHERE name = m.name) ELSE NULL END AS index_bytes,
  NULL AS row_count
FROM sqlite_master m
WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'
ORDER BY total_bytes DESC NULLS LAST
LIMIT 1000
`.trim(),
    };
  }
  if (f === 'duckdb') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  schema_name,
  table_name AS object_name,
  'table' AS object_type,
  table_name,
  estimated_size AS total_bytes,
  estimated_size AS data_bytes,
  NULL AS index_bytes,
  estimated_size AS row_count
FROM duckdb_tables()
ORDER BY estimated_size DESC NULLS LAST
LIMIT 1000
`.trim(),
    };
  }
  if (f === 'clickhouse') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  database AS schema_name,
  table AS object_name,
  'table' AS object_type,
  table AS table_name,
  sum(bytes_on_disk) AS total_bytes,
  sum(data_uncompressed_bytes) AS data_bytes,
  NULL AS index_bytes,
  sum(rows) AS row_count
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY total_bytes DESC
LIMIT 1000
`.trim(),
    };
  }
  if (f === 'redshift') {
    return {
      mode: asMode(mode),
      params: [],
      sql: `
SELECT
  schema AS schema_name,
  "table" AS object_name,
  'table' AS object_type,
  "table" AS table_name,
  size * 1024 * 1024 AS total_bytes,
  size * 1024 * 1024 AS data_bytes,
  NULL AS index_bytes,
  tbl_rows AS row_count
FROM svv_table_info
ORDER BY size DESC
LIMIT 1000
`.trim(),
    };
  }
  return { error: 'No object-size probe for this dialect.' };
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.toLowerCase() === lower) return v;
    }
  }
  return undefined;
}

export function normalizeConnectionPoolRows(
  rows: Record<string, unknown>[]
): ConnectionPoolInfo {
  const row = rows[0] ?? {};
  const maxConnections = num(pick(row, 'max_connections', 'maxConnections'));
  const currentConnections = num(pick(row, 'current_connections', 'currentConnections'));
  const activeConnections = num(pick(row, 'active_connections', 'activeConnections'));
  const availableConnections = num(pick(row, 'available_connections', 'availableConnections'));
  const waitCount = num(pick(row, 'wait_count', 'waitCount'));
  const details: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const key = k.toLowerCase();
    if (
      key.includes('max_connection') ||
      key.includes('current_connection') ||
      key.includes('active_connection') ||
      key.includes('available_connection') ||
      key.includes('wait_count')
    ) {
      continue;
    }
    details.push({ key: k, value: String(v) });
  }
  const available =
    availableConnections ??
    (maxConnections != null && currentConnections != null
      ? Math.max(0, maxConnections - currentConnections)
      : null);
  return {
    maxConnections,
    currentConnections,
    activeConnections,
    availableConnections: available,
    waitCount,
    details,
  };
}

export function normalizeUserSessionRows(
  rows: Record<string, unknown>[]
): UserSessionRow[] {
  return rows.map((row) => ({
    sessionId: str(pick(row, 'session_id', 'sessionId', 'pid', 'id')) || '—',
    userName: str(pick(row, 'user_name', 'userName', 'usename', 'user', 'login_name')),
    clientHost: str(pick(row, 'client_host', 'clientHost', 'host', 'host_name', 'remotehost')),
    databaseName: str(pick(row, 'database_name', 'databaseName', 'datname', 'db')),
    state: str(pick(row, 'state', 'status', 'command')),
    waitEvent: str(pick(row, 'wait_event', 'waitEvent', 'wait_type', 'event')),
    queryText: str(pick(row, 'query_text', 'queryText', 'query', 'info', 'text')),
    connectedAt: str(pick(row, 'connected_at', 'connectedAt', 'backend_start', 'login_time')),
    applicationName: str(pick(row, 'application_name', 'applicationName', 'program_name', 'program')),
  }));
}

export function normalizeSystemInfoRows(rows: Record<string, unknown>[]): SystemInfoMetric {
  const row = rows[0] ?? {};
  const memoryTotalBytes = num(pick(row, 'memory_total_bytes', 'memoryTotalBytes'));
  const memoryAvailableBytes = num(pick(row, 'memory_available_bytes', 'memoryAvailableBytes'));
  let memoryUsedBytes = num(pick(row, 'memory_used_bytes', 'memoryUsedBytes'));
  if (memoryUsedBytes == null && memoryTotalBytes != null && memoryAvailableBytes != null) {
    memoryUsedBytes = Math.max(0, memoryTotalBytes - memoryAvailableBytes);
  }
  const details: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const key = k.toLowerCase();
    if (
      key.includes('cpu') ||
      key.includes('memory') ||
      key.includes('storage') ||
      key.includes('uptime') ||
      key.includes('server_version')
    ) {
      continue;
    }
    details.push({ key: k, value: String(v) });
  }
  return {
    cpuCount: num(pick(row, 'cpu_count', 'cpuCount')),
    cpuUsagePercent: num(pick(row, 'cpu_usage_percent', 'cpuUsagePercent')),
    memoryTotalBytes,
    memoryUsedBytes,
    memoryAvailableBytes,
    storageTotalBytes: num(pick(row, 'storage_total_bytes', 'storageTotalBytes')),
    storageUsedBytes: num(pick(row, 'storage_used_bytes', 'storageUsedBytes')),
    storageAvailableBytes: num(pick(row, 'storage_available_bytes', 'storageAvailableBytes')),
    uptimeSeconds: num(pick(row, 'uptime_seconds', 'uptimeSeconds')),
    serverVersion: str(pick(row, 'server_version', 'serverVersion', 'version')),
    details,
  };
}

export function normalizeObjectSizeRows(rows: Record<string, unknown>[]): ObjectSizeRow[] {
  return rows.map((row) => {
    const rawType = (str(pick(row, 'object_type', 'objectType')) || 'other').toLowerCase();
    const objectType: ObjectSizeRow['objectType'] =
      rawType === 'table' || rawType === 'index' ? rawType : 'other';
    return {
      schemaName: str(pick(row, 'schema_name', 'schemaName', 'schema')),
      objectName: str(pick(row, 'object_name', 'objectName', 'name', 'table')) || '—',
      objectType,
      tableName: str(pick(row, 'table_name', 'tableName', 'table')),
      totalBytes: num(pick(row, 'total_bytes', 'totalBytes', 'size')),
      dataBytes: num(pick(row, 'data_bytes', 'dataBytes')),
      indexBytes: num(pick(row, 'index_bytes', 'indexBytes')),
      rowCount: num(pick(row, 'row_count', 'rowCount', 'rows', 'card')),
    };
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const abs = Math.abs(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let n = abs;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const signed = bytes < 0 ? '-' : '';
  return `${signed}${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
