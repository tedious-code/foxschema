export {
  checkStatement,
  isWriteStatement,
  firstKeyword,
  extractTableAliases,
  statementVerb,
  isMutatingDmlStatement,
  dmlLacksWhere,
  parseCodeCell,
  findCodeFences,
  stripJsStringsAndComments,
  stripCodeFenceMarkers,
  codeCellHasReturn,
  stripFullLineSqlComments,
  isCodeCellKind,
  isNodeCodeCellKind,
  codeCellNeedsTs,
  nodeCodeCellWireKind,
  isCodeCellLast,
  isCodeCellVars,
  CODE_CELL_KIND_LABEL,
} from '@foxschema/core';
export type {
  SplitStatement,
  StatementStatus,
  StatementKind,
  CodeCellKind,
  BrowserCodeCellKind,
  NodeCodeCellKind,
  TsCodeCellKind,
  CodeCellLast,
  CodeCellVars,
  CodeCellOk,
  CodeCellErr,
  CodeCellResult,
} from '@foxschema/core';

export {
  CODE_CELL_ALLOWED_PACKAGES,
  parseCodeCellImports,
  resolveCodeCellImportBindings,
  prepareCodeCellImports,
  normalizeCodeCellReturn,
  cloneCodeCellLast,
  runCodeCellBody,
} from '@foxschema/core';
export type {
  CodeCellAllowedPackage,
  CodeCellImportSpec,
  RunCodeCellBodyArgs,
} from '@foxschema/core';

import { splitSqlStatements as splitSqlStatementsUncached } from '@foxschema/core';
import type { SplitStatement } from '@foxschema/core';

/** Tiny LRU so keystroke paths (store + strip + gutter) reuse one split of the same buffer. */
const SPLIT_CACHE = new Map<string, SplitStatement[]>();
const SPLIT_CACHE_MAX = 4;

export function splitSqlStatements(sql: string): SplitStatement[] {
  const hit = SPLIT_CACHE.get(sql);
  if (hit) {
    SPLIT_CACHE.delete(sql);
    SPLIT_CACHE.set(sql, hit);
    return hit;
  }
  const stmts = splitSqlStatementsUncached(sql);
  if (SPLIT_CACHE.size >= SPLIT_CACHE_MAX) {
    const oldest = SPLIT_CACHE.keys().next().value;
    if (oldest !== undefined) SPLIT_CACHE.delete(oldest);
  }
  SPLIT_CACHE.set(sql, stmts);
  return stmts;
}

export {
  sqlTag,
  renderSqlQuery,
  isSqlQuery,
  makeSqlQuery,
  placeholderStyleFor,
  quoteSqlIdentifier,
} from '@foxschema/core';
export type { SqlQuery, SqlTag, RenderedSql, SqlPlaceholderStyle } from '@foxschema/core';
