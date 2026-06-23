import envPaths from 'env-paths';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// XDG-style locations: ~/.config/foxschema, ~/.local/share/foxschema, etc.
// (no "-nodejs" suffix). The config holds only non-secret state — the encryption
// key lives in the OS keychain, never here.
const paths = envPaths('foxschema', { suffix: '' });

export const CONFIG_DIR = paths.config;
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const DEFAULT_DB_PATH = join(paths.data, 'foxschema.db');

export type DbEngine = 'sqlite' | 'postgres' | 'mysql';

export interface CliConfig {
  setupComplete: boolean;
  email: string;
  dbEngine: DbEngine;
  dbPath: string; // sqlite file location
  dbUrl: string; // postgres/mysql connection string
  keyScheme: 'v1' | 'v2';
}

const DEFAULT_CONFIG: CliConfig = {
  setupComplete: false,
  email: '',
  dbEngine: 'sqlite',
  dbPath: '',
  dbUrl: '',
  keyScheme: 'v2',
};

export function readConfig(): CliConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<CliConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: CliConfig): void {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
