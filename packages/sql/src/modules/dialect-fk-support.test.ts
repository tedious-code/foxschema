import { describe, expect, it } from 'vitest';
import { dialectSupportsFk } from './dialect-fk-support.js';

describe('dialectSupportsFk', () => {
  it('disables FK for ClickHouse', () => {
    expect(dialectSupportsFk('clickhouse')).toMatchObject({
      alterAdd: false,
      createInline: false,
      composite: false,
    });
  });

  it('allows CREATE-inline only for SQLite', () => {
    expect(dialectSupportsFk('sqlite')).toMatchObject({
      alterAdd: false,
      createInline: true,
      composite: true,
    });
  });

  it('supports composite ALTER ADD for postgres', () => {
    expect(dialectSupportsFk('postgres')).toMatchObject({
      alterAdd: true,
      createInline: true,
      composite: true,
    });
  });
});
