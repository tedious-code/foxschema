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
