/** Thin re-export facade over `@foxschema/sql` for per-column/trigger deploy selection. */
export {
  applyColumnSelection,
  applySelectionToDiff,
  applyTriggerSelection,
  blockedColumns,
  columnExclusionBlock,
  columnExclusionConsequences,
} from '@foxschema/sql';
export type { ExclusionBlock, ExclusionContext } from '@foxschema/sql';
