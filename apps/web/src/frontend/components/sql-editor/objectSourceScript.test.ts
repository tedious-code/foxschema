import { describe, expect, it } from 'vitest';
import { isScriptableObject, objectSourceScript } from './objectSourceScript';
import type { TableSchema } from '../../lib/types';

function view(partial: Partial<TableSchema> & Pick<TableSchema, 'name'>): TableSchema {
  return {
    name: partial.name,
    objectType: 'VIEW',
    columns: [],
    indexes: [],
    foreignKeys: [],
    definition: partial.definition,
    ...partial,
  } as TableSchema;
}

describe('objectSourceScript', () => {
  it('marks VIEW / PROCEDURE / FUNCTION as scriptable', () => {
    expect(isScriptableObject('VIEW')).toBe(true);
    expect(isScriptableObject('PROCEDURE')).toBe(true);
    expect(isScriptableObject('FUNCTION')).toBe(true);
    expect(isScriptableObject('TABLE')).toBe(false);
    expect(isScriptableObject('MQT')).toBe(false);
  });

  it('returns definition for a view and ensures a trailing semicolon', () => {
    const sql = objectSourceScript(
      view({ name: 'v_orders', definition: 'CREATE VIEW v_orders AS SELECT 1 AS id' }),
      'postgres'
    );
    expect(sql).toContain('v_orders');
    expect(sql.trimEnd().endsWith(';')).toBe(true);
  });

  it('falls back when definition is missing', () => {
    const sql = objectSourceScript(view({ name: 'v_empty' }), 'postgres');
    expect(sql).toMatch(/No definition available/i);
    expect(sql).toContain('v_empty');
  });
});
