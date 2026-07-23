// Re-export from core browser entry — single source of truth for statement
// splitting and the editor's per-statement heuristics (same code the backend
// uses to validate /sql/execute requests).
export { splitSqlStatements, checkStatement, isWriteStatement, firstKeyword, extractTableAliases, statementVerb, isMutatingDmlStatement, dmlLacksWhere } from '@foxschema/core';
export type { SplitStatement, StatementStatus } from '@foxschema/core';
