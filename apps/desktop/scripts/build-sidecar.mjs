// Assembles the Node sidecar that the Tauri shell spawns:
//   1. esbuild-bundles the Express backend into one server.cjs (our TS +
//      @foxschema/* inlined; native/driver deps left external).
//   2. Ships the external drivers (pg, ibm_db + DB2 clidriver) as a pruned
//      node_modules next to the bundle.
//   3. Copies a Node runtime binary named with the Rust host target triple,
//      which Tauri picks up as `externalBin`.
//
// NOTE: for local dev this copies the *current* Node (v24, which includes
// node:sqlite). For release builds, swap in a pinned Node 22 LTS per platform.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, chmodSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repoRoot = resolve(desktop, '..', '..');
const srcTauri = join(desktop, 'src-tauri');
const serverDir = join(srcTauri, 'resources', 'server');
const binariesDir = join(srcTauri, 'binaries');

// External (not bundled) — native addons + drivers shipped in node_modules.
const EXTERNAL = ['pg', 'pg-native', 'mysql2', 'ibm_db'];

function hostTriple() {
  // Cross-compiling (e.g. `tauri build --target x86_64-apple-darwin` for a
  // DB2-enabled Intel build on an Apple Silicon Mac) means the actual build
  // TARGET differs from the machine's native host — and rustc -vV only ever
  // reports the latter. Tauri sets TAURI_ENV_PLATFORM/TAURI_ENV_ARCH to the
  // real target for beforeBuildCommand/beforeDevCommand hooks (this script),
  // so check those first.
  const envPlatform = process.env.TAURI_ENV_PLATFORM;
  const envArch = process.env.TAURI_ENV_ARCH;
  if (envPlatform && envArch) {
    const osMap = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', windows: 'pc-windows-msvc' };
    const os = osMap[envPlatform];
    if (os) return `${envArch}-${os}`;
  }

  // No cross-compile target set — ask rustc, authoritative for the host build
  // (also correct when Node itself is the mismatched one, e.g. an x64 Node
  // under Rosetta on an otherwise-native arm64 machine).
  // Try PATH and the default rustup location (not on the npm shell's PATH).
  const candidates = ['rustc', join(process.env.HOME ?? '', '.cargo', 'bin', 'rustc')];
  for (const bin of candidates) {
    try {
      const out = execSync(`"${bin}" -vV`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/^host:\s*(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* try next candidate */ }
  }

  // Last resort: derive from Node's platform/arch (may be wrong under Rosetta).
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
  const map = {
    darwin: `${arch}-apple-darwin`,
    linux: `${arch}-unknown-linux-gnu`,
    win32: `${arch}-pc-windows-msvc`,
  };
  const triple = map[process.platform];
  if (!triple) throw new Error(`Unsupported platform for sidecar: ${process.platform}/${process.arch}`);
  return triple;
}

async function bundleServer() {
  rmSync(serverDir, { recursive: true, force: true });
  mkdirSync(serverDir, { recursive: true });
  await build({
    entryPoints: [join(repoRoot, 'apps', 'web', 'src', 'backend', 'index.ts')],
    outfile: join(serverDir, 'server.mjs'),
    bundle: true,
    platform: 'node',
    // ESM output keeps import.meta.url valid, which the engine relies on for
    // createRequire-based lazy driver loading (pg / ibm_db) and the default DB
    // path. Drivers are resolved at runtime from the sibling node_modules.
    format: 'esm',
    target: 'node22',
    external: EXTERNAL,
    logLevel: 'warning',
    // Node-ESM interop: provide a real require/__filename/__dirname so bundled
    // CJS deps (express, cors, …) and the engine's createRequire driver loading
    // work. esbuild's __require shim uses this top-level `require` when present.
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        "import { fileURLToPath as __fileURLToPath } from 'node:url';",
        "import { dirname as __pathDirname } from 'node:path';",
        'const require = __createRequire(import.meta.url);',
        'const __filename = __fileURLToPath(import.meta.url);',
        'const __dirname = __pathDirname(__filename);',
      ].join('\n'),
    },
  });
}

function shipDrivers() {
  const nm = join(serverDir, 'node_modules');
  mkdirSync(nm, { recursive: true });

  const deps = ['pg', 'pg-protocol', 'pg-types', 'pg-connection-string', 'pgpass',
                'postgres-array', 'postgres-bytea', 'postgres-date', 'postgres-interval',
                'split2', 'xtend'];

  // DB2 (ibm_db) bundles a ~64MB native clidriver tree of loose files that
  // trips Tauri's resource walker (EACCES) and bloats incremental builds. It's
  // opt-in until packaged as a single extracted-on-first-run archive (see the
  // DB2 packaging step). Enable with INCLUDE_DB2=1.
  if (process.env.INCLUDE_DB2 === '1') deps.push('ibm_db');

  for (const dep of deps) {
    const from = join(repoRoot, 'node_modules', dep);
    if (existsSync(from)) cpSync(from, join(nm, dep), { recursive: true, dereference: true });
  }
}

function shipNodeBinary() {
  rmSync(binariesDir, { recursive: true, force: true });
  mkdirSync(binariesDir, { recursive: true });
  const triple = hostTriple();
  const ext = process.platform === 'win32' ? '.exe' : '';
  const dest = join(binariesDir, `foxschema-sidecar-${triple}${ext}`);
  copyFileSync(process.execPath, dest);
  if (process.platform !== 'win32') chmodSync(dest, 0o755);
  console.log(`[sidecar] node runtime → ${dest}`);
}

await bundleServer();
shipDrivers();
shipNodeBinary();
console.log('[sidecar] done.');
