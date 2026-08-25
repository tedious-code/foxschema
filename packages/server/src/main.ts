import { setupDb2ClientEnv } from '@foxschema/db';
import { startServer } from './api/server';

// Load a local .env (SSO credentials, UPDATE_FEED_URL, etc.) from the working
// directory if present — convenient for local dev. No-ops when there's no file.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

setupDb2ClientEnv();

// startServer is async now (Fastify's listen is). Without awaiting, a boot
// failure would surface as an unhandled rejection with no exit code.
startServer().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
