#!/usr/bin/env node
/**
 * Prepare a publishable folder for the public `foxschema` npm package.
 * The CLI build already inlines @foxschema/core + @foxschema/web; published
 * deps are only native drivers + CLI runtime libs (no private workspace pkgs).
 *
 * Usage (from repo root, after builds):
 *   node apps/cli/scripts/prepare-publish.mjs
 *   npm publish apps/cli/npm-pack
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(cliRoot, 'npm-pack');
const srcPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const webPkg = JSON.parse(
  readFileSync(resolve(cliRoot, '..', 'web', 'package.json'), 'utf8')
);

if (!existsSync(join(cliRoot, 'dist', 'index.js'))) {
  throw new Error('Missing apps/cli/dist — run `npm run build -w @foxschema/cli` first');
}
if (!existsSync(join(cliRoot, 'ui-dist', 'index.html'))) {
  throw new Error('Missing apps/cli/ui-dist — build @foxschema/web then rebuild the CLI');
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(cliRoot, 'dist'), join(outDir, 'dist'), { recursive: true });
cpSync(join(cliRoot, 'ui-dist'), join(outDir, 'ui-dist'), { recursive: true });

const readmeSrc = join(cliRoot, 'README.md');
if (existsSync(readmeSrc)) {
  cpSync(readmeSrc, join(outDir, 'README.md'));
} else {
  writeFileSync(
    join(outDir, 'README.md'),
    `# foxschema

Fox Schema CLI — schema diff & migration.

\`\`\`bash
npm install -g foxschema
foxschema
\`\`\`

Opens http://localhost:3210 with the local UI + API.

See https://github.com/tedious-code/foxschema
`
  );
}

const publishPkg = {
  name: 'foxschema',
  version: srcPkg.version,
  description: srcPkg.description,
  license: srcPkg.license || 'Apache-2.0',
  homepage: srcPkg.homepage,
  bugs: srcPkg.bugs,
  repository: srcPkg.repository,
  keywords: srcPkg.keywords,
  type: 'module',
  engines: srcPkg.engines,
  bin: srcPkg.bin,
  files: ['dist', 'ui-dist', 'README.md'],
  dependencies: {
    '@napi-rs/keyring': srcPkg.dependencies['@napi-rs/keyring'],
    chalk: srcPkg.dependencies.chalk,
    commander: srcPkg.dependencies.commander,
    'env-paths': srcPkg.dependencies['env-paths'],
    '@inquirer/prompts': srcPkg.dependencies['@inquirer/prompts'],
    ink: srcPkg.dependencies.ink,
    'ink-select-input': srcPkg.dependencies['ink-select-input'],
    'ink-spinner': srcPkg.dependencies['ink-spinner'],
    'ink-text-input': srcPkg.dependencies['ink-text-input'],
    react: srcPkg.dependencies.react,
    // Drivers left external by the esbuild bundles:
    pg: webPkg.dependencies.pg,
    mysql2: webPkg.dependencies.mysql2,
    mssql: webPkg.dependencies.mssql,
    oracledb: webPkg.dependencies.oracledb,
    'better-sqlite3': webPkg.dependencies['better-sqlite3'],
    '@clickhouse/client': webPkg.dependencies['@clickhouse/client'],
    '@duckdb/node-api': webPkg.dependencies['@duckdb/node-api'],
  },
  optionalDependencies: {
    // DB2 is opt-in (large clidriver; no linux/arm64). Prefer:
    //   foxschema drivers install db2
    // or Docker 5nickels/foxschema:db2-latest
  },
  publishConfig: { access: 'public' },
};

writeFileSync(join(outDir, 'package.json'), JSON.stringify(publishPkg, null, 2) + '\n');
console.log(`✔ prepared ${outDir} (foxschema@${publishPkg.version})`);
