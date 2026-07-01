import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from apps/e2e/ if present (local dev credentials for Docker DBs).
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  const raw = readFileSync(envFile, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

export default defineConfig({
  test: {
    // E2E tests launch real browsers — each test needs a generous timeout.
    testTimeout: 90_000,
    hookTimeout: 60_000,
    // Run tests serially: one browser at a time avoids port conflicts.
    fileParallelism: false,
    reporters: ['verbose'],
  },
});
