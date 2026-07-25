export {
  splitSqlStatements,
  checkStatement,
  isWriteStatement,
  firstKeyword,
  extractTableAliases,
  statementVerb,
  isMutatingDmlStatement,
  dmlLacksWhere,
  parseCodeCell,
  findCodeFences,
  stripCodeFenceMarkers,
  codeCellHasReturn,
} from '@foxschema/core';
export type { SplitStatement, StatementStatus, StatementKind } from '@foxschema/core';
