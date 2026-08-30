/**
 * Fox Schema (@foxschema/db)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which ClickHouse client call each statement gets.
 *
 * `client.query()` appends `FORMAT JSONEachRow`, because it exists to read a
 * result set back. ClickHouse's parser tolerates that trailing clause on table
 * DDL — which is why migrations worked — but the access-management grammar has
 * a fixed tail and rejects it, so every statement the Database Access feature
 * produced came back as `Syntax error … FORMAT`. `client.command()` sends the
 * statement as written.
 *
 * The routing is a denylist of statements known to return no rows rather than
 * an allowlist of the ones that do: anything unrecognised keeps the `query()`
 * path, so a statement that returns rows today cannot start silently returning
 * none.
 */
import { describe, expect, it } from 'vitest';
import { clickHouseAdapter } from './clickhouse.adapter';

/** Records which client method each statement was sent through. */
function fakeClient() {
  const queried: string[] = [];
  const commanded: string[] = [];
  return {
    queried,
    commanded,
    query: async ({ query }: { query: string }) => {
      queried.push(query);
      return { json: async () => [{ ok: 1 }] };
    },
    command: async ({ query }: { query: string }) => {
      commanded.push(query);
    },
  };
}

const run = async (sql: string, params: readonly unknown[] = []) => {
  const client = fakeClient();
  const rows = await clickHouseAdapter.query(client, sql, params);
  return { ...client, rows };
};

describe('statements that return no rows', () => {
  it.each([
    ["CREATE USER `report_user` IDENTIFIED WITH sha256_password BY 'x'", 'create user'],
    ['CREATE ROLE `analysts`', 'create role'],
    ['DROP USER `report_user`', 'drop user'],
    ['ALTER USER `report_user` RENAME TO `r2`', 'alter user'],
    ['GRANT SELECT ON demo.* TO report_user', 'grant'],
    ['REVOKE SELECT ON demo.* FROM report_user', 'revoke'],
  ])('sends %s through command(), not query()', async (sql) => {
    const { queried, commanded, rows } = await run(sql);
    expect(commanded).toEqual([sql]);
    expect(queried).toEqual([]);
    // No result set to hand back, and none is invented.
    expect(rows).toEqual([]);
  });

  it('routes table DDL and writes the same way', async () => {
    for (const sql of [
      'CREATE TABLE demo.t (id Int32) ENGINE = MergeTree() ORDER BY id',
      'DROP TABLE demo.t',
      'INSERT INTO demo.t VALUES (1)',
      'TRUNCATE TABLE demo.t',
    ]) {
      const { commanded, queried } = await run(sql);
      expect(commanded, sql).toEqual([sql]);
      expect(queried, sql).toEqual([]);
    }
  });

  it('sees past leading comments to the verb', async () => {
    // The SQL editor sends what the user typed, header comments included.
    const sql = "-- add the reporting account\n/* reviewed */ CREATE USER `r` IDENTIFIED WITH no_password";
    const { commanded, queried } = await run(sql);
    expect(commanded).toEqual([sql]);
    expect(queried).toEqual([]);
  });
});

describe('statements that return rows', () => {
  it.each([
    'SELECT name FROM system.users',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'SHOW TABLES',
    'DESCRIBE TABLE demo.t',
    'EXPLAIN SELECT 1',
  ])('keeps %s on query(), so the rows still come back', async (sql) => {
    const { queried, commanded, rows } = await run(sql);
    expect(queried).toEqual([sql]);
    expect(commanded).toEqual([]);
    expect(rows).toEqual([{ ok: 1 }]);
  });

  it('leaves an unrecognised statement on the row-returning path', async () => {
    // Fail towards today's behaviour: a verb this list has never heard of must
    // not be quietly turned into a call that discards its result set.
    const { queried, commanded } = await run('DESC demo.t');
    expect(queried).toEqual(['DESC demo.t']);
    expect(commanded).toEqual([]);
  });
});

describe('parameter substitution still applies', () => {
  it('fills $N before deciding how to send the statement', async () => {
    const { queried } = await run('SELECT * FROM system.users WHERE name = $1', ['alice']);
    expect(queried).toEqual(["SELECT * FROM system.users WHERE name = 'alice'"]);
  });

  it('quotes a value that would otherwise end the literal', async () => {
    const { queried } = await run('SELECT $1', ["o'brien"]);
    expect(queried[0]).toBe("SELECT 'o\\'brien'");
  });
});
