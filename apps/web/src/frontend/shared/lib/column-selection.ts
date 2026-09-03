/** Thin re-export facade over `@foxschema/sql` for per-column/trigger deploy selection. */
export {
  applyColumnSelection,
  applyTriggerSelection,
  blockedColumns,
  columnExclusionBlock,
} from '@foxschema/sql';
export type { ExclusionBlock } from '@foxschema/sql';
