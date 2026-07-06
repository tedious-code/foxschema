import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

// Bundle the CLI to a single ESM file. @foxschema/* TS sources are inlined;
// native drivers stay external (resolved from node_modules at runtime, like the
// desktop sidecar). The banner shims `require` for any bundled CJS deps.
//
// The tui/ subtree is deliberately NOT part of this bundle — src/index.ts's
// `tui` command loads it via a *computed* dynamic import (`new URL(...,
// import.meta.url)`), which esbuild can never inline (only literal-string
// import() targets get bundled). It's built as its own separate ESM file
// below instead, with Ink/React external there too: every tui/*.tsx screen
// statically `import {Box} from 'ink'`, and if those ever ended up inside a
// CJS-capable bundle, esbuild would turn each into a synchronous
// `require('ink')` — which breaks outright once Ink's own yoga-layout
// dependency (a top-level `await` in its ESM entry) is on the other end of
// that require. Keeping ink/react external and letting Node's own loader
// resolve them, in a real standalone ESM file, sidesteps that entirely — see
// build-binary.mjs's longer comment for how this bit us for real.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  // esbuild keeps the source's `#!/usr/bin/env node`; the banner only shims
  // `require` for any bundled CJS deps.
  banner: {
    js: ['import { createRequire as ___cr } from "node:module";', 'const require = ___cr(import.meta.url);'].join('\n'),
  },
  external: ['ibm_db', 'pg', 'mysql2', '@napi-rs/keyring'],
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
});

chmodSync('dist/index.js', 0o755);
console.log('✔ built dist/index.js');

// The tui/ sub-bundle — same source, separate output, ESM (tolerates
// yoga-layout's top-level await), Ink/React resolved from node_modules at
// runtime rather than bundled in.
await build({
  entryPoints: ['src/tui/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/tui/index.js',
  // Same native-driver exclusions as the main bundle above — tui/ pulls in
  // runtime/bootstrap.ts -> keyring.ts (@napi-rs/keyring) transitively, and
  // the DB providers via runtime/engine.ts, since both bundles share the same
  // runtime/ layer.
  external: ['ibm_db', 'pg', 'mysql2', '@napi-rs/keyring', 'ink', 'ink-select-input', 'ink-text-input', 'ink-spinner', 'react', 'react-reconciler', 'yoga-layout'],
  logLevel: 'info',
});
console.log('✔ built dist/tui/index.js');
