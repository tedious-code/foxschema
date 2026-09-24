import { requireReady } from './bootstrap';
import { AuthModule } from '@foxschema/server';
import { ConnectionStore } from '@foxschema/server';
import { MigrationHistoryStore } from '@foxschema/server';

export interface CliContext {
  userId: string;
  connections: ConnectionStore;
  history: MigrationHistoryStore;
}

let ctx: CliContext | null = null;

/**
 * Ready-to-use context: applies the stored config + keychain key to the env
 * (so the shared store/crypto run), ensures the local user, and returns the
 * connection + history stores. Throws a clear message if not set up.
 */
export async function getContext(): Promise<CliContext> {
  if (ctx) return ctx;
  requireReady();
  const user = await new AuthModule().ensureLocalUser();
  ctx = { userId: user.id, connections: new ConnectionStore(), history: new MigrationHistoryStore() };
  return ctx;
}
