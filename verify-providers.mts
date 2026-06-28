import { getRegisteredProvider } from '@foxschema/core';
import type { ConnectionOptions } from '@foxschema/shared';

async function run(label: string, dialect: string, options: ConnectionOptions, schema: string) {
  const provider = getRegisteredProvider(dialect);
  const ok = await provider.testConnection(options).catch((e) => `ERR ${e.message}`);
  const tables = await provider.getTables!(options, schema);
  const byType: Record<string, number> = {};
  for (const t of tables) byType[t.objectType] = (byType[t.objectType] ?? 0) + 1;
  console.log(`\n===== ${label} (${dialect}) =====  testConnection=${ok}`);
  console.log('object counts:', byType);
  for (const t of tables) {
    const bits: string[] = [`[${t.objectType}] ${t.name}`];
    if (t.columns.length) bits.push(`cols(${t.columns.map((c) => `${c.name}:${c.type}`).join(', ')})`);
    if (t.primaryKey) bits.push(`PK(${t.primaryKey.columns.join(',')})`);
    if (t.foreignKeys.length) bits.push(`FK(${t.foreignKeys.map((f) => `${f.columns.join(',')}->${f.referencedTable}.${f.referencedColumns.join(',')}`).join('; ')})`);
    if (t.indices.length) bits.push(`IDX(${t.indices.map((i) => `${i.name}${i.unique ? '*' : ''}`).join(',')})`);
    if (t.parameters?.length) bits.push(`params(${t.parameters.map((p) => `${p.mode} ${p.name} ${p.type}`).join(', ')})`);
    if (t.userType?.attributes?.length) bits.push(`enum(${t.userType.attributes.map((a) => a.name).join(',')})`);
    if (t.sequence) bits.push(`seq(start=${t.sequence.start})`);
    console.log('   ' + bits.join('  '));
  }
  // Self-compare sanity: a schema diffed against itself must be identical.
  return tables;
}

const pg: ConnectionOptions = { host: 'localhost', port: 55432, database: 'appdb', username: 'postgres', password: 'secret', schema: 'public' };
const my: ConnectionOptions = { host: 'localhost', port: 55306, database: 'appdb', username: 'root', password: 'secret' };
const maria: ConnectionOptions = { host: 'localhost', port: 55307, database: 'appdb', username: 'root', password: 'secret' };

await run('Postgres', 'postgres', pg, 'public');
await run('MySQL', 'mysql', my, 'appdb');
await run('MariaDB', 'mariadb', maria, 'appdb');

// Verify the compare engine sees the live schema as identical to itself (zero drift).
const { CompareModule } = await import('@foxschema/core');
const cmp = new CompareModule();
for (const [label, dialect, opt, schema] of [
  ['Postgres', 'postgres', pg, 'public'],
  ['MySQL', 'mysql', my, 'appdb'],
  ['MariaDB', 'mariadb', maria, 'appdb'],
] as const) {
  const p = getRegisteredProvider(dialect);
  const a = await p.getTables!(opt, schema);
  const b = await p.getTables!(opt, schema);
  const result = await cmp.compare(a, b);
  const { added, removed, modified, unchanged } = result.summary;
  console.log(`self-compare ${label}: ${result.tables.length} objects (unchanged=${unchanged}, added=${added}, removed=${removed}, modified=${modified}) — expect only unchanged`);
}

process.exit(0);
