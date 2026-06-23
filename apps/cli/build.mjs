import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

// Bundle the CLI to a single ESM file. @foxschema/* TS sources are inlined;
// native drivers stay external (resolved from node_modules at runtime, like the
// desktop sidecar). The banner shims `require` for any bundled CJS deps.
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
  logLevel: 'info',
});

chmodSync('dist/index.js', 0o755);
console.log('✔ built dist/index.js');
