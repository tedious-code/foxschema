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
return {
  columns: ['id', 'email', 'n'],
  rows: last.rows.map((r) => [r[0], r[1], Number(r[0]) * 2]),
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
for (const r of last.rows) {
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
return _.map(last.rows, doubleRow);
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

return last.rows.map((r) => ({
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
return last.rows.map((r) => ({ id: Number(r[0]), email: r[1] }));
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
const out = [];
let i = 0;
while (i < last.rows.length) {
  const id = Number(last.rows[i][0]);
  if (isOdd(id)) {
    out.push({ id, email: last.rows[i][1], kind: 'odd' });
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
