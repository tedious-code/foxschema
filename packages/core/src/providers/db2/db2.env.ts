import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);

let configured = false;

/**
 * Point the process at ibm_db's bundled clidriver before loading native bindings.
 * Helps avoid SQL1042C caused by missing/wrong CLI library paths.
 */
export function setupDb2ClientEnv(): void {
  if (configured) return;

  try {
    const pkgPath = nodeRequire.resolve('ibm_db/package.json');
    const clidriverDir = path.join(path.dirname(pkgPath), 'installer', 'clidriver');
    const libDir = path.join(clidriverDir, 'lib');
    const binDir = path.join(clidriverDir, 'bin');

    if (!fs.existsSync(clidriverDir)) {
      return;
    }

    process.env.IBM_DB_HOME = clidriverDir;

    if (process.platform === 'darwin') {
      process.env.DYLD_LIBRARY_PATH = prependPath(process.env.DYLD_LIBRARY_PATH, libDir);
      process.env.PATH = prependPath(process.env.PATH, binDir);
    } else if (process.platform === 'linux') {
      process.env.LD_LIBRARY_PATH = prependPath(process.env.LD_LIBRARY_PATH, libDir);
      process.env.PATH = prependPath(process.env.PATH, binDir);
    } else if (process.platform === 'win32') {
      process.env.PATH = prependPath(process.env.PATH, binDir, libDir);
      process.env.LIB = prependPath(process.env.LIB, libDir, binDir);
    }

    configured = true;
  } catch {
    // ibm_db not installed yet
  }
}

function prependPath(current: string | undefined, ...dirs: string[]): string {
  const existing = current?.split(path.delimiter).filter(Boolean) ?? [];
  const merged = [...dirs, ...existing.filter((d) => !dirs.includes(d))];
  return merged.join(path.delimiter);
}
