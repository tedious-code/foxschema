import envPaths from 'env-paths';
import { join } from 'node:path';

/** XDG-style locations for the CLI (same app name as config.ts). */
export const paths = envPaths('foxschema', { suffix: '' });

// env-paths has no dedicated runtime dir; use cache/runtime for PID locks.
export const RUNTIME_DIR = join(paths.cache, 'runtime');
export const DATA_DIR = paths.data;
export const PID_FILE = join(RUNTIME_DIR, 'ui-server.pid');
export const PORT_FILE = join(RUNTIME_DIR, 'ui-server.port');
export const LOCAL_KEY_FILE = join(DATA_DIR, '.app_encryption_key');

/** Default port for the browser UI launcher (Docker stays on 3001). */
export const DEFAULT_UI_PORT = 3210;
