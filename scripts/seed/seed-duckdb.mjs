#!/usr/bin/env node
/**
 * Seed DuckDB demo files for local / e2e use.
 * Writes /tmp/foxschema-duckdb/demo_{a,b}.duckdb from docker/init/duckdb/*.sql
 */
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INIT = join(__dirname, '../../docker/init/duckdb');
const OUT = process.env.FOXSCHEMA_DUCKDB_DIR || '/tmp/foxschema-duckdb';

const require = createRequire(import.meta.url);
const { DuckDBInstance } = require('@duckdb/node-api');

async function seedFile(sqlName, outName) {
  const sql = readFileSync(join(INIT, sqlName), 'utf8');
  const path = join(OUT, outName);
  rmSync(path, { force: true });
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  await conn.run(sql);
  conn.closeSync?.();
  instance.closeSync?.();
  return path;
}

mkdirSync(OUT, { recursive: true });
const a = await seedFile('demo_a.sql', 'demo_a.duckdb');
const b = await seedFile('demo_b.sql', 'demo_b.duckdb');
console.log(`  ✓ DuckDB seeded  →  ${a}  |  ${b}`);
