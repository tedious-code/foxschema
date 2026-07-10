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
import { cpSync, mkdirSync, rmSync, existsSync, chmodSync, copyFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repoRoot = resolve(desktop, '..', '..');
const srcTauri = join(desktop, 'src-tauri');
const serverDir = join(srcTauri, 'resources', 'server');
const binariesDir = join(srcTauri, 'binaries');

// External (not bundled into server.mjs) — instead shipped as a pruned
// node_modules tree next to it (see shipDrivers). The desktop app can't install
// drivers at runtime the way the web edition does (`pnpm add`): the .app bundle
// is read-only and code-signed, end users have no package manager, and the
// bundled server only resolves modules from its own node_modules. So every
// driver a packaged build supports must be bundled here at build time. These
// are marked external (not inlined by esbuild) because they use dynamic
// require() patterns that don't survive bundling.
const EXTERNAL = ['pg', 'pg-native', 'mysql2', 'mssql', 'oracledb', 'ibm_db'];

// Drivers bundled into every desktop build. Their full transitive dep trees are
// copied by shipDrivers. Notes:
//   - oracledb runs in thin mode (no Oracle Instant Client needed).
//   - ibm_db (DB2) ships its own ~64MB CLI driver tree; npm's postinstall fetches
//     the per-platform prebuilt binding + clidriver (MacARM64/Mac-x64/Win64/
//     Linux x64 are all supported by ibm_db >= 3.3.0, NAPI since 4.0.0), so the
//     CI runner for each target OS produces the right one. copyDepTree copies it
//     with symlinks dereferenced, which also avoids the resource-walker EACCES
//     that previously made DB2 opt-in.
const BUNDLED_DRIVERS = ['pg', 'mysql2', 'mssql', 'oracledb', 'ibm_db'];

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

// Resolve a package's directory: prefer a copy nested under the requiring
// package, else the hoisted copy at the repo root (npm/pnpm flatten most deps
// to the root, but keep conflicting versions nested).
function resolvePkgDir(name, fromDir) {
  const nested = join(fromDir, 'node_modules', name);
  if (existsSync(join(nested, 'package.json'))) return nested;
  const hoisted = join(repoRoot, 'node_modules', name);
  if (existsSync(join(hoisted, 'package.json'))) return hoisted;
  return null;
}

// Copy each entry package and its full (optional-)dependency tree into `outNm`
// (flat — safe because the resolved deps are the hoisted ones). Returns the set
// of copied package names. Missing packages are warned about, not fatal, so an
// absent optional dep (e.g. a driver's platform-specific extra) doesn't abort
// the whole build.
function copyDepTree(entryPkgs, outNm) {
  const copied = new Set();
  const queue = entryPkgs.map((name) => ({ name, fromDir: repoRoot }));
  while (queue.length) {
    const { name, fromDir } = queue.shift();
    if (copied.has(name)) continue;
    const dir = resolvePkgDir(name, fromDir);
    if (!dir) {
      console.warn(`[sidecar] driver dependency not found, skipping: ${name}`);
      continue;
    }
    copied.add(name);
    cpSync(dir, join(outNm, name), { recursive: true, dereference: true });
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
    for (const d of Object.keys(deps)) {
      if (!copied.has(d)) queue.push({ name: d, fromDir: dir });
    }
  }
  return copied;
}

// Replace every symlink under `root` with a real copy of its resolved target.
// Two reasons this is required, both from ibm_db's DB2 clidriver:
//   1. cpSync(dereference) rewrites nested relative symlinks (e.g. the
//      libDB2xml4c .dylib version aliases) into ABSOLUTE symlinks pointing back
//      at the build machine's node_modules — dead links on a user's machine.
//   2. Tauri's resource walker chokes (EACCES) on symlinks in the bundled tree.
// Resolving them to plain files sidesteps both. Runs on the build machine where
// the link targets still exist, so realpath resolves correctly.
function flattenSymlinks(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const real = realpathSync(p); // resolves to the actual file, wherever it lives
        rmSync(p, { force: true });
        cpSync(real, p, { recursive: true }); // real copy (target is a normal file/dir now)
      } catch {
        rmSync(p, { force: true }); // broken link — drop it rather than ship a dead one
      }
    } else if (entry.isDirectory()) {
      flattenSymlinks(p);
    }
  }
}

function shipDrivers() {
  const nm = join(serverDir, 'node_modules');
  mkdirSync(nm, { recursive: true });

  const copied = copyDepTree(BUNDLED_DRIVERS, nm);
  flattenSymlinks(nm);

  // ibm_db's DB2 clidriver ships many read-only (0555) files. Tauri's macOS
  // bundle step runs `xattr -cr` over the whole app to strip quarantine/extra
  // attributes, which fails with EACCES on files it can't write — the real
  // reason DB2 bundling used to break. Make the shipped tree owner-writable so
  // that pass succeeds. (No-op concern on Windows: it has no such xattr step.)
  if (process.platform !== 'win32') {
    execSync(`chmod -R u+w "${nm}"`);
  }

  console.log(`[sidecar] bundled ${copied.size} driver package(s): ${BUNDLED_DRIVERS.join(', ')}`);
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
