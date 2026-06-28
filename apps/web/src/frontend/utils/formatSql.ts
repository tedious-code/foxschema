import { format } from 'sql-formatter';


const LANGUAGE_BY_DIALECT: Record<string, string> = {
  db2: 'db2',
  mySql: 'mysql',
  mariaDb: 'mariadb',
  oracle: 'plsql',
  postgres: 'postgresql',
  sqlServer: 'tsql',
  sqlLite: 'sqlite'
};


/**
 * Pretty-prints catalog DDL (views, triggers, routines often come back as one line).
 * Falls back to the raw text when the formatter can't parse vendor-specific syntax.
 */
export function formatSql(sql: string, dialect: string): string {
  if (!sql || !sql.trim()) return sql;
  try {
    return format(sql, {
      language: (LANGUAGE_BY_DIALECT[dialect.toLowerCase()] ?? 'sql') as any,
      keywordCase: 'upper',
      tabWidth: 1,
      indentStyle: 'tabularLeft'
    });
  } catch {
    return sql;
  }
}
