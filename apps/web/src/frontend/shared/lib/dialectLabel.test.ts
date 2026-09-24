import { describe, expect, it } from 'vitest';
import { connectionOptionLabel, dialectLabel } from './dialectLabel';

describe('connectionOptionLabel', () => {
  it('uses the written dialect name, the connection name and its schema', () => {
    expect(connectionOptionLabel({ dialect: 'sqlserver', name: 'Orders', schema: 'dbo' })).toBe(
      `[${dialectLabel('sqlserver').toUpperCase()}] Orders · dbo`,
    );
    expect(dialectLabel('sqlserver')).not.toBe('SQLSERVER');
  });

  it('leaves out a missing schema', () => {
    expect(connectionOptionLabel({ dialect: 'sqlite', name: 'Local' })).toBe('[SQLITE] Local');
  });
});
