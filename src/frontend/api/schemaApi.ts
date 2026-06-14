import type {
  ConnectionOptions,
  DriverInfo,
  TableSchema,
} from '../../backend/interfaces/schema-provider.interface';
import type { MigrationStep } from '../../backend/modules/sql-generator.module';
import type { MigrationEvent } from '../../backend/modules/migration.module';
import type { SchemaCompareResult } from '../../backend/types/diff.types';
import type { DbObjectType } from '../../backend/interfaces/schema-provider.interface';

interface CompareSide {
  dialect: string;
  option: ConnectionOptions;
  schema: string;
}

/** Runs the schema comparison server-side and returns only the diff result. */
export async function compareSchemas(
  source: CompareSide,
  target: CompareSide,
  scope: DbObjectType[]
): Promise<SchemaCompareResult> {
  return parseJson<SchemaCompareResult>(
    await fetch(`${API_BASE}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, scope }),
    })
  );
}

const API_BASE = '/api';

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data === 'object' && data && 'error' in data && data.error
        ? data.error
        : res.statusText
    );
  }
  return data;
}

export async function checkDriver(dialect: string): Promise<DriverInfo> {
  return parseJson<DriverInfo>(
    await fetch(`${API_BASE}/driver/check?dialect=${encodeURIComponent(dialect)}`)
  );
}

export async function installDriver(dialect: string): Promise<{ success: boolean; stdout?: string; error?: string }> {
  return parseJson<{ success: boolean; stdout?: string; error?: string }>(
    await fetch(`${API_BASE}/driver/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialect }),
    })
  );
}


export async function testConnection(
  dialect: string,
  option: ConnectionOptions,
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/connection/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dialect, option }),
  });

  const data = (await res.json()) as { success: boolean; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }

  if (!data.success) {
    throw new Error(data.error ?? 'Connection test returned false');
  }

  return true;
}

export async function fetchSchemaList(
  dialect: string,
  option: ConnectionOptions
): Promise<string[]> {
  const data = await parseJson<{ schemas: string[] }>(
    await fetch(`${API_BASE}/schema/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialect, option }),
    })
  );
  return data.schemas;
}

/** Streams NDJSON migration progress events, invoking onEvent for each. */
export async function executeMigration(
  dialect: string,
  option: ConnectionOptions,
  schema: string,
  steps: MigrationStep[],
  onEvent: (e: MigrationEvent) => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/migration/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dialect, option, schema, steps }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Migration request failed: ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) onEvent(JSON.parse(line) as MigrationEvent);
    }
  }
}

export async function fetchTables(
  dialect: string,
  option: ConnectionOptions,
  schema: string
): Promise<TableSchema[]> {
  const data = await parseJson<{ tables: TableSchema[] }>(
    await fetch(`${API_BASE}/schema/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialect, option, schema }),
    })
  );
  return data.tables;
}
