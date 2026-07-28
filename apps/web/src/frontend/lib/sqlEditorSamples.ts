/**
 * Built-in SQL Editor sample bookmarks (browser JS/TS + Node code cells).
 * Install via Bookmarks → "Add samples". Stable ids so re-install updates in place.
 */

export type SqlEditorSample = {
  /** Stable id — used as bookmark id when installed. */
  id: string;
  title: string;
  sql: string;
};

/** Cross-dialect demo rows (no user tables required). */
const DEMO_PEOPLE_SQL = `SELECT 1 AS id, 'alice@example.com' AS email
UNION ALL
SELECT 2, 'bob@example.com'
UNION ALL
SELECT 3, 'cara@example.com'`;

export const SQL_EDITOR_SAMPLE_BOOKMARKS: SqlEditorSample[] = [
  {
    id: 'sample-js-map-last',
    title: '★ Sample · JS map last rows',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
-- @set doubled = table
// last is null when no statement ran before this cell — guard so running
// the cell on its own reports an empty grid instead of a TypeError.
const src = last?.rows ?? [];
return {
  columns: ['id', 'email', 'n'],
  rows: src.map((r) => [r[0], r[1], Number(r[0]) * 2]),
};
-- @end
`,
  },
  {
    id: 'sample-js-loop-locals',
    title: '★ Sample · JS loop + locals',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
const out = [];
const factor = 2;
for (const r of last?.rows ?? []) {
  const id = Number(r[0]);
  out.push({ id, email: r[1], n: id * factor });
}
return out;
-- @end
`,
  },
  {
    id: 'sample-js-lodash',
    title: '★ Sample · JS lodash import',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
import _ from 'lodash';

function doubleRow(r) {
  return { id: r[0], email: r[1], n: Number(r[0]) * 2 };
}
return _.map(last?.rows ?? [], doubleRow);
-- @end
`,
  },
  {
    id: 'sample-js-date-fns',
    title: '★ Sample · JS date-fns',
    sql: `SELECT '2020-01-02' AS day
UNION ALL
SELECT '2021-06-15';

-- @js
import { format, parseISO } from 'date-fns';

return (last?.rows ?? []).map((r) => ({
  day: r[0],
  stamped: format(parseISO(String(r[0])), 'yyyy-MM-dd'),
}));
-- @end
`,
  },
  {
    id: 'sample-ts-typed',
    title: '★ Sample · TS typed transform',
    sql: `${DEMO_PEOPLE_SQL};

-- @ts
const factor: number = 3;
const out = (last ? last.rows : []).map((r: unknown[]) => ({
  id: Number(r[0]),
  email: String(r[1]),
  n: Number(r[0]) * factor,
}));
return out;
-- @end
`,
  },
  {
    id: 'sample-js-chain-cells',
    title: '★ Sample · JS chain (SQL → JS → JS)',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
-- @set step1 = table
return (last?.rows ?? []).map((r) => ({ id: Number(r[0]), email: r[1] }));
-- @end

-- @js
// Use last from the previous cell (and/or vars.step1 after @set).
const rows = last && last.rows.length ? last.rows : (vars.step1 ? vars.step1.rows : []);
return rows.map((r) => ({
  id: r[0],
  email: r[1],
  domain: String(r[1]).split('@')[1] || '',
}));
-- @end
`,
  },
  {
    id: 'sample-js-filter-while',
    title: '★ Sample · JS filter + while',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
function isOdd(n) {
  return n % 2 === 1;
}
const rows = last?.rows ?? [];
const out = [];
let i = 0;
while (i < rows.length) {
  const id = Number(rows[i][0]);
  if (isOdd(id)) {
    out.push({ id, email: rows[i][1], kind: 'odd' });
  }
  i++;
}
return out;
-- @end
`,
  },
  {
    id: 'sample-js-pure-grid',
    title: '★ Sample · JS only (no SQL)',
    sql: `-- @js
import { groupBy } from 'lodash-es';

const rows = [
  { kind: 'a', n: 1 },
  { kind: 'a', n: 2 },
  { kind: 'b', n: 3 },
];
const grouped = groupBy(rows, 'kind');
return [{ a: grouped.a.length, b: grouped.b.length }];
-- @end
`,
  },
  {
    id: 'sample-js-async-fetch',
    title: '★ Sample · JS async fetch',
    sql: `-- @js
const res = await fetch('https://httpbin.org/get');
const json = await res.json();
return [{
  status: res.status,
  url: json.url ?? '',
  origin: json.origin ?? '',
}];
-- @end
`,
  },
  {
    id: 'sample-node-async-fetch',
    title: '★ Sample · Node async fetch',
    sql: `-- @node
const res = await fetch('https://httpbin.org/get');
const json = await res.json();
return [{
  status: res.status,
  url: json.url ?? '',
  origin: json.origin ?? '',
  runtime: 'node',
}];
-- @end
`,
  },
  {
    id: 'sample-ts-async-fetch',
    title: '★ Sample · TS async fetch',
    sql: `-- @ts
type HttpBinGet = { url?: string; origin?: string };

const res = await fetch('https://httpbin.org/get');
const json = (await res.json()) as HttpBinGet;
return [{
  status: res.status,
  url: json.url ?? '',
  origin: json.origin ?? '',
  runtime: 'browser-ts',
}];
-- @end
`,
  },
  {
    id: 'sample-nodets-async-fetch',
    title: '★ Sample · Node-TS async fetch',
    sql: `-- @nodets
type HttpBinGet = { url?: string; origin?: string };

const res = await fetch('https://httpbin.org/get');
const json = (await res.json()) as HttpBinGet;
return [{
  status: res.status,
  url: json.url ?? '',
  origin: json.origin ?? '',
  runtime: 'node-ts',
}];
-- @end
`,
  },
  {
    id: 'sample-node-sql-transform',
    title: '★ Sample · SQL → Node transform',
    sql: `${DEMO_PEOPLE_SQL};

-- @node
import _ from 'lodash';

// Guarded so the cell also runs standalone (no preceding SELECT).
return _.map(last?.rows ?? [], (r) => ({
  id: Number(r[0]),
  email: String(r[1]),
  domain: String(r[1]).split('@')[1] || '',
  runtime: 'node',
}));
-- @end
`,
  },
  {
    id: 'sample-js-set-vars',
    title: '★ Sample · @set + vars',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
-- @set people = table
return (last?.rows ?? []).map((r) => ({ id: Number(r[0]), email: r[1] }));
-- @end

-- @js
// Prefer vars.people after @set (last is the previous cell's grid too).
const grid = vars.people;
if (!grid) return [];
return grid.rows.map((r) => ({
  id: r[0],
  email: r[1],
  fromVars: true,
}));
-- @end
`,
  },
  {
    id: 'sample-js-promise-all',
    title: '★ Sample · JS Promise.all fetch',
    sql: `-- @js
const urls = [
  'https://httpbin.org/uuid',
  'https://httpbin.org/uuid',
];
const results = await Promise.all(
  urls.map(async (url) => {
    const res = await fetch(url);
    const json = await res.json();
    return { status: res.status, uuid: json.uuid ?? '' };
  })
);
return results;
-- @end
`,
  },
  {
    id: 'sample-js-lodash-aggregate',
    title: '★ Sample · JS lodash aggregate',
    sql: `SELECT 'a' AS kind, 10 AS n
UNION ALL
SELECT 'a', 5
UNION ALL
SELECT 'b', 7
UNION ALL
SELECT 'b', 3;

-- @js
import { groupBy, sumBy } from 'lodash-es';

const rows = (last?.rows ?? []).map((r) => ({
  kind: String(r[0]),
  n: Number(r[1]),
}));
const byKind = groupBy(rows, 'kind');
return Object.keys(byKind).map((kind) => ({
  kind,
  count: byKind[kind].length,
  total: sumBy(byKind[kind], 'n'),
}));
-- @end
`,
  },
  {
    id: 'sample-js-columns-rows',
    title: '★ Sample · JS { columns, rows }',
    sql: `${DEMO_PEOPLE_SQL};

-- @js
// Explicit grid shape (alternative to returning objects).
return {
  columns: ['id', 'email', 'upper'],
  rows: (last?.rows ?? []).map((r) => [
    Number(r[0]),
    String(r[1]),
    String(r[1]).toUpperCase(),
  ]),
};
-- @end
`,
  },
  {
    id: 'sample-js-api-post',
    title: '★ Sample · JS API POST (headers/query/body)',
    sql: `-- @js
// Query string, custom headers, and JSON body (httpbin echoes them back).
const url = new URL('https://httpbin.org/post');
url.searchParams.set('source', 'foxschema');
url.searchParams.set('demo', '1');

const res = await fetch(url.toString(), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-FoxSchema-Client': 'sql-editor',
    Authorization: 'Bearer demo-token',
  },
  body: JSON.stringify({
    action: 'ping',
    items: [1, 2, 3],
  }),
});
const json = await res.json();
return [{
  status: res.status,
  querySource: json.args?.source ?? '',
  queryDemo: json.args?.demo ?? '',
  authHeader: json.headers?.Authorization ?? json.headers?.authorization ?? '',
  bodyAction: json.json?.action ?? '',
  bodyItemCount: Array.isArray(json.json?.items) ? json.json.items.length : 0,
}];
-- @end
`,
  },
  {
    id: 'sample-js-api-bearer-secret',
    title: '★ Sample · JS API Bearer from secret',
    sql: `-- Add Variables → apiToken (check Secret) and set a session value, or create
-- an App Secret named apiToken (Secrets sidebar). Then Run.

-- @js
const token = vars.apiToken?.value;
if (token === undefined || token === null || String(token).length === 0) {
  return [{
    ok: false,
    hint: 'Set secret variable or App Secret named apiToken, then re-run',
  }];
}

const url = new URL('https://httpbin.org/post');
url.searchParams.set('via', 'secret-var');

const res = await fetch(url.toString(), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + String(token),
  },
  body: JSON.stringify({ hello: 'foxschema' }),
});
const json = await res.json();
return [{
  status: res.status,
  authEcho: json.headers?.Authorization ?? json.headers?.authorization ?? '',
  bodyHello: json.json?.hello ?? '',
}];
-- @end
`,
  },
  {
    id: 'sample-node-api-post',
    title: '★ Sample · Node API POST (headers/query/body)',
    sql: `-- @node
const url = new URL('https://httpbin.org/post');
url.searchParams.set('source', 'foxschema-node');

const res = await fetch(url.toString(), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-FoxSchema-Runtime': 'node',
    Authorization: 'Bearer demo-token',
  },
  body: JSON.stringify({ action: 'ping', runtime: 'node' }),
});
const json = await res.json();
return [{
  status: res.status,
  querySource: json.args?.source ?? '',
  authHeader: json.headers?.Authorization ?? json.headers?.authorization ?? '',
  bodyAction: json.json?.action ?? '',
  runtime: 'node',
}];
-- @end
`,
  },
  {
    id: 'sample-node-sql-basics',
    title: '★ Sample · Node sql`` parameterized read',
    sql: `-- Needs a checked credential — \`sql\` runs on it. Read-only, safe with Safe mode ON.

-- @node
// Every \${...} becomes a bind parameter, so a value can never become SQL.
// The apostrophe below would break a hand-built string; here it is just data.
const email = "o'brien@example.com";
const id = 42;

const rows = await sql\`SELECT \${id} AS id, \${email} AS email\`;
return rows;
-- @end
`,
  },
  {
    id: 'sample-node-sql-injection-safe',
    title: '★ Sample · Node sql`` injection is impossible',
    sql: `-- Read-only demo: a classic injection payload stays an ordinary string value.

-- @node
const evil = "1; DROP TABLE accounts; --";

// Bound as one parameter — the server never sees it as SQL.
const rows = await sql\`SELECT \${evil} AS attempted, 'table still here' AS status\`;
return rows;
-- @end
`,
  },
  {
    id: 'sample-node-sql-bulk-load',
    title: '★ Sample · Node bulk load from JS values',
    sql: `-- WRITES — turn Safe mode OFF to run. Written for Postgres / MySQL / SQLite /
-- SQL Server (Oracle and Db2 spell DROP ... IF EXISTS differently).

-- @node
const values = [
  { id: 1, email: "o'brien@example.com", note: null },
  { id: 2, email: 'ada@example.com', note: 'new' },
  { id: 3, email: 'grace@example.com', note: null },
];

await sql\`DROP TABLE IF EXISTS fox_demo_accounts\`;
await sql\`CREATE TABLE fox_demo_accounts (id INTEGER, email VARCHAR(200), note VARCHAR(200))\`;

// One statement, all rows, every value bound: ("id","email","note") VALUES (?,?,?), ...
await sql\`INSERT INTO \${sql.id('fox_demo_accounts')} \${sql.values(values)}\`;

return await sql\`SELECT id, email, note FROM fox_demo_accounts ORDER BY id\`;
-- @end
`,
  },
  {
    id: 'sample-node-sql-migrate',
    title: '★ Sample · Node migrate: read → reshape → write',
    sql: `-- WRITES — turn Safe mode OFF. Run the "bulk load" sample first to create
-- fox_demo_accounts. This is the shape most data migrations take.

-- @node
// Rows come back as objects keyed by column name. Some engines fold names to
// upper case (Oracle/Db2), so read defensively when writing cross-dialect.
const src = await sql\`SELECT id, email FROM fox_demo_accounts ORDER BY id\`;

const rows = src.map((r) => {
  const email = String(r.email ?? r.EMAIL ?? '');
  return {
    id: Number(r.id ?? r.ID),
    email: email.toLowerCase(),
    domain: email.split('@')[1] ?? '',
  };
});

await sql\`DROP TABLE IF EXISTS fox_demo_accounts_v2\`;
await sql\`CREATE TABLE fox_demo_accounts_v2 (id INTEGER, email VARCHAR(200), domain VARCHAR(200))\`;
await sql\`INSERT INTO \${sql.id('fox_demo_accounts_v2')} \${sql.values(rows)}\`;

return await sql\`SELECT id, email, domain FROM fox_demo_accounts_v2 ORDER BY id\`;
-- @end
`,
  },
  {
    id: 'sample-node-sql-chunked',
    title: '★ Sample · Node chunked insert + IN list',
    sql: `-- WRITES — turn Safe mode OFF. Loads 250 rows in batches, then reads a few back.

-- @node
const table = 'fox_demo_bulk';
const all = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: 'row ' + (i + 1) }));

await sql\`DROP TABLE IF EXISTS fox_demo_bulk\`;
await sql\`CREATE TABLE fox_demo_bulk (id INTEGER, name VARCHAR(100))\`;

// Batch rather than one giant statement — engines cap bind parameters per call.
const CHUNK = 50;
let inserted = 0;
for (let i = 0; i < all.length; i += CHUNK) {
  const chunk = all.slice(i, i + CHUNK);
  await sql\`INSERT INTO \${sql.id(table)} \${sql.values(chunk)}\`;
  inserted += chunk.length;
}

// A bare array expands to an IN list: (?, ?, ?)
const sample = await sql\`SELECT id, name FROM \${sql.id(table)} WHERE id IN \${[1, 125, 250]} ORDER BY id\`;

// Keep one uniform shape so the grid has no ragged columns.
return sample.map((r) => ({ id: r.id, name: r.name, inserted }));
-- @end
`,
  },
];

export function buildSampleBookmarks(now = Date.now()): Array<{
  id: string;
  title: string;
  sql: string;
  selectedConnectionIds: string[];
  updatedAt: number;
}> {
  return SQL_EDITOR_SAMPLE_BOOKMARKS.map((s) => ({
    id: s.id,
    title: s.title,
    sql: s.sql,
    selectedConnectionIds: [] as string[],
    updatedAt: now,
  }));
}
