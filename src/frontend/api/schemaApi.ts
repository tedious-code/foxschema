import type {
  ConnectionOptions,
  DriverInfo,
  TableSchema,
} from '../../backend/interfaces/schema-provider.interface';

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

export async function testConnection(
  dialect: string,
  option: ConnectionOptions
): Promise<boolean> {
  const data = await parseJson<{ success: boolean; error?: string }>(
    await fetch(`${API_BASE}/connection/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialect, option }),
    })
  );
  return data.success;
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
