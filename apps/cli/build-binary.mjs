/*
 * M6 — build a self-contained `foxschema` executable via Node SEA (Single
 * Executable Applications). The Node runtime is embedded, so end users DON'T
 * need Node installed. Output: dist-bin/foxschema + dist-bin/node_modules with
 * the native keychain dep (node:sqlite is built into Node; DB drivers are opt-in).
 *
 * Run: node build-binary.mjs   (macOS/Linux; Windows needs the signtool path)
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const OUT = 'dist-bin';
const isMac = process.platform === 'darwin';
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1) CommonJS bundle (SEA's main script must be CJS). Native deps stay external
//    and are resolved from node_modules NEXT TO the executable — SEA's built-in
//    require only loads builtins, so the banner rebinds require via createRequire
//    anchored at the executable directory.
//
// The tui/ subtree is NOT part of this bundle. src/index.ts's `tui` command loads
// it via `new URL('./tui/index.js', import.meta.url)` — a *computed* dynamic
// import, which esbuild can never inline (only literal-string import() targets
// get bundled) — and it's built as its own separate ESM file in step 1b below.
// This split is required, not just tidy: every tui/*.tsx screen statically
// `import {Box} from 'ink'`, and if those files were ever discovered inside
// *this* CJS bundle, esbuild would rewrite each into a synchronous
// `require('ink')`. That fails outright the moment any screen's module runs,
// because ink's own yoga-layout dependency has a top-level `await` in its ESM
// entry, and Node's require(esm) interop refuses to evaluate that
// synchronously — confirmed by reproducing it directly against a real esbuild
// CJS bundle (`require() cannot be used on an ESM graph with top-level await`,
// pointing at ink/build/index.js). A dynamic `import()` of ink from *this*
// file would have been fine on its own; the problem was ink's *consumers*
// (ink-select-input etc.) ending up bundled alongside it here too.
console.log('• bundling (cjs)…');
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: `${OUT}/cli.cjs`,
  external: ['ibm_db', 'pg', 'mysql2', '@napi-rs/keyring'],
  // `import.meta.url` is undefined in CJS, which breaks the providers'
  // module-level `createRequire(import.meta.url)`. Point it (and the rebound
  // require) at an exec-dir file URL so node_modules resolve next to the binary.
  // The tui/ sub-bundle's own location is resolved relative to this SAME value
  // (see src/index.ts), which is exactly why it must point at cli.cjs's real
  // parent directory rather than anything internal to the SEA blob.
  define: { __CLI_VERSION__: JSON.stringify(pkg.version), 'import.meta.url': '__cliMetaUrl' },
  banner: {
    js:
      'var __cliMetaUrl=require("node:url").pathToFileURL(' +
      'require("node:path").join(require("node:path").dirname(process.execPath),"cli.cjs")).href;' +
      'require=require("node:module").createRequire(__cliMetaUrl);',
  },
  logLevel: 'info',
});

// 1b) The tui/ sub-bundle — same source, separate output, ESM (tolerates
// yoga-layout's top-level await unlike the cjs bundle above), Ink/React
// resolved from node_modules next to the executable rather than bundled in.
console.log('• bundling tui/ (esm)…');
await build({
  entryPoints: ['src/tui/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: `${OUT}/tui/index.js`,
  // Same native-driver exclusions as the cjs bundle above — tui/ pulls in
  // runtime/bootstrap.ts -> keyring.ts (@napi-rs/keyring) transitively, and the
  // DB providers via runtime/engine.ts, since both bundles share the same
  // runtime/ layer.
  external: ['ibm_db', 'pg', 'mysql2', '@napi-rs/keyring', 'ink', 'ink-select-input', 'ink-text-input', 'ink-spinner', 'react', 'react-reconciler', 'yoga-layout'],
  logLevel: 'info',
});

// 2) SEA blob
console.log('• generating SEA blob…');
writeFileSync(
  `${OUT}/sea-config.json`,
  JSON.stringify({ main: 'cli.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true }, null, 2)
);
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: OUT, stdio: 'inherit' });

// 3) Copy the node binary and inject the blob
console.log('• injecting into a copy of node…');
const exe = join(OUT, isMac || process.platform === 'linux' ? 'foxschema' : 'foxschema.exe');
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (isMac) {
  try {
    execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
  } catch {
    /* unsigned already */
  }
}
const postjectArgs = [exe, 'NODE_SEA_BLOB', `${OUT}/sea-prep.blob`, '--sentinel-fuse', FUSE];
if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
execFileSync('npx', ['--yes', 'postject', ...postjectArgs], { stdio: 'inherit' });
if (isMac) execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' }); // ad-hoc re-sign

// 4) Ship the native keychain dep beside the binary (napi platform pkgs included)
console.log('• copying native deps (@napi-rs/keyring)…');
const napiDir = dirname(dirname(require.resolve('@napi-rs/keyring/package.json'))); // node_modules/@napi-rs
cpSync(napiDir, `${OUT}/node_modules/@napi-rs`, { recursive: true });

console.log(`\n✔ Built ${exe}`);
console.log('  Distribute the dist-bin/ folder (binary + node_modules). DB2 needs ibm_db added alongside.');
console.log(
  '  `fox tui` additionally needs ink, ink-select-input, ink-text-input, ink-spinner, react,\n' +
    '  react-reconciler, and yoga-layout in dist-bin/node_modules (same opt-in pattern as the DB drivers) —\n' +
    '  not copied automatically since every other command works without them.'
);
