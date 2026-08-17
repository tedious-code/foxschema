import { type TableSchema, type DbObjectType } from './schema-provider.interface.js';

export type DiffType = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface ColumnDiff {
  /** Uppercased compare-key match name — NOT a real identifier, see source.name. */
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  /**
   * `name` is the column's own identifier in its native casing, which is what
   * DDL must use — the same trap as `IndexDiff` below. Compare has always
   * passed the whole ColumnInfo through; only this declaration hid the field,
   * so `ALTER TABLE … ADD "NEW COL"` was emitted for a column actually called
   * `new col`. Optional rather than required because this package is
   * published — every producer inside the repo sets it.
   */
  source?: { name?: string; type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean; collation?: string };
  target?: { name?: string; type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean; collation?: string };
}

export interface IndexDiff {
  /** Uppercased compare-key match name — NOT a real identifier, see source.name. */
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  /**
   * `name` here is the index's own identifier in its native casing, which is
   * what DDL must use. Compare has always passed the whole IndexInfo through;
   * only this declaration hid the field, so generators reached for the
   * uppercased key instead and emitted IDX_CUSTOMERS_EMAIL for
   * idx_customers_email. Optional rather than required because this package is
   * published — every producer inside the repo sets it.
   */
  source?: { name?: string; columns: string[]; unique: boolean; constraint?: boolean };
  target?: { name?: string; columns: string[]; unique: boolean; constraint?: boolean };
  /**
   * True when this ADDED/REMOVED pair is only an index rename: same columns +
   * uniqueness as an unmatched index on the other side. Does not mark the table
   * MODIFIED in the compare tree; still shown in the schema blueprint so the
   * user can opt in to migrate the name.
   */
  nameOnly?: boolean;
}

export interface ForeignKeyDiff {
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { columns: string[]; referencedTable: string; referencedColumns: string[] };
  target?: { columns: string[]; referencedTable: string; referencedColumns: string[] };
}

export interface TriggerDiff {
  /** Uppercased compare-key match name — NOT a real identifier, see schema.name below. */
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { name: string; timing?: string; event?: string; definition?: string };
  target?: { name: string; timing?: string; event?: string; definition?: string };
}

export interface TableDiff {
  tableName: string;
  objectType: DbObjectType;
  status: DiffType;
  definition?: string;
  columnDiffs: ColumnDiff[];
  indexDiffs: IndexDiff[];
  foreignKeyDiffs: ForeignKeyDiff[];
  triggerDiffs?: TriggerDiff[];
  sourceTable?: TableSchema;
  targetTable?: TableSchema;
}

export interface SchemaCompareResult {
  tables: TableDiff[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  /** Non-fatal notices, e.g. an object class that could not be read (insufficient privileges). */
  warnings?: string[];
}
