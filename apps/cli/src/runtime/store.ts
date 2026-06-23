import { readConfig } from './config';
import { applyEnv } from './bootstrap';
import { AuthModule } from '@foxschema/web/auth';
import { ConnectionStore } from '@foxschema/web/connection-store';
import { MigrationHistoryStore } from '@foxschema/web/migration-history';

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
  if (!readConfig().setupComplete) {
    throw new Error('Not set up yet — run `foxschema setup` first.');
  }
  if (!applyEnv()) {
    throw new Error(
      'Encryption key unavailable (keychain locked or moved). Re-run `foxschema setup`, or set FOXSCHEMA_KEY.'
    );
  }
  const user = await new AuthModule().ensureLocalUser();
  ctx = { userId: user.id, connections: new ConnectionStore(), history: new MigrationHistoryStore() };
  return ctx;
}
