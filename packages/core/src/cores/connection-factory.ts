
import { ConnectionOptions } from '../interfaces';
import { getProviderSettings } from '../providers/provider-settings';
import { getAdapter, ADAPTERS } from '../providers/adapter-registry';

/**
 * Generic connection orchestrator. All dialect-specific behaviour lives in the
 * per-provider DriverAdapter — this layer only builds the connection string and
 * delegates, so adding a database platform never touches this file.
 */
/**
 * Node's dual-stack TCP connect (e.g. host "localhost" resolving to both ::1
 * and 127.0.0.1 with nothing listening on either) throws an AggregateError
 * whose own `.message` is `''` — the real reasons live in `.errors`. Left
 * as-is, every provider's `error.message` rethrow surfaces that empty string
 * (the client then shows a bare "Internal Server Error"). Join the nested
 * messages instead so the real cause reaches the UI.
 */
function describeConnectionError(error: unknown): Error {
  if (error instanceof AggregateError && !error.message && error.errors?.length) {
    const message = error.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join('; ');
    return new Error(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export class ConnectionFactory {
  static async create(
    provider: string,
    options: ConnectionOptions,
    opts: { pooled?: boolean } = {}
  ): Promise<any> {
    const adapter = getAdapter(provider);
    const connectionString = getProviderSettings(provider).buildConnectionString(options);
    try {
      return await adapter.acquire(connectionString, options, opts.pooled !== false);
    } catch (error) {
      throw describeConnectionError(error);
    }
  }

  static async close(provider: string, connection: any): Promise<void> {
    if (!connection) return;
    await getAdapter(provider).release(connection);
  }

  /**
   * Closes every pooled connection across all adapters. Call on graceful
   * shutdown so the process can exit cleanly instead of hanging on DB handles.
   */
  static async closeAll(): Promise<void> {
    await Promise.all(
      Object.values(ADAPTERS).map((adapter) =>
        adapter.closeAll().catch((err) => console.error(`Error closing ${adapter.dialect} pool:`, err))
      )
    );
  }

  /** One-shot query: acquire, run, release. */
  static async executeQuery<T = Record<string, unknown>>(
    provider: string,
    options: ConnectionOptions,
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {
    const connection = await this.create(provider, options);
    try {
      return await getAdapter(provider).query<T>(connection, sql, params);
    } finally {
      await this.close(provider, connection);
    }
  }

  /** Query on an existing connection (used when loading a whole schema). */
  static executeOnConnection<T = Record<string, unknown>>(
    provider: string,
    connection: any,
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {
    return getAdapter(provider).query<T>(connection, sql, params);
  }
}
