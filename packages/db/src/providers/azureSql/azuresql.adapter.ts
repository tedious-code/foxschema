/**
 * Azure SQL speaks the SQL Server protocol through the same mssql driver; the
 * adapter is SQL Server's with encryption on by default.
 */
import { MssqlAdapter } from '../sqlServer/sqlserver.adapter.js';

export const azureSqlAdapter = new MssqlAdapter('azuresql', true);
