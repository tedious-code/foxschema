/**
 * Fox Schema (@foxschema/db)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL Server and Azure SQL share one adapter class. What must still differ is
 * the dialect each registers under and Azure's encryption-on default.
 */
import { describe, expect, it } from 'vitest';
import { sqlServerAdapter } from './sqlserver.adapter.js';
import { azureSqlAdapter } from '../azureSql/azuresql.adapter.js';

const config = (adapter: unknown) =>
  (adapter as { buildConfig(o: object): { options: { encrypt: boolean } } }).buildConfig({ host: 'h' });

describe('MssqlAdapter instances', () => {
  it('register as two dialects with separate pools', () => {
    expect(sqlServerAdapter.dialect).toBe('sqlserver');
    expect(azureSqlAdapter.dialect).toBe('azuresql');
    expect(sqlServerAdapter).not.toBe(azureSqlAdapter);
  });

  it('encrypts by default only for Azure SQL', () => {
    expect(config(sqlServerAdapter).options.encrypt).toBe(false);
    expect(config(azureSqlAdapter).options.encrypt).toBe(true);
  });
});
