import { setupDb2ClientEnv } from '@foxschema/core';
import { startServer } from './api/server';

// Load a local .env (SSO credentials, UPDATE_FEED_URL, etc.) from the working
// directory if present — convenient for local dev. No-ops when there's no file.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

setupDb2ClientEnv();
startServer();
