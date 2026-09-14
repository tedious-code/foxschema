import { describe, expect, it } from 'vitest';
import { maxInsertRows } from './insert-limits.js';

describe('maxInsertRows', () => {
  it('keeps SQL Server under both its parameter and VALUES-row limits', () => {
    expect(maxInsertRows('sqlserver', 1)).toBe(1_000);
    expect(maxInsertRows('azuresql', 5)).toBe(400);
    expect(maxInsertRows('mssql', 5)).toBe(400);
  });

  it('writes Oracle one row per statement', () => {
    expect(maxInsertRows('oracle', 3)).toBe(1);
  });

  it('divides the parameter budget by the columns elsewhere', () => {
    expect(maxInsertRows('postgres', 10)).toBe(6_553);
    expect(maxInsertRows('SQLITE', 3)).toBe(10_922);
  });

  it('always allows at least one row', () => {
    expect(maxInsertRows('sqlserver', 5_000)).toBe(1);
    expect(maxInsertRows('postgres', 0)).toBe(65_535);
  });
});
