import { TableSchema, DbObjectType } from './schema-provider.interface';

export type DiffType = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface ColumnDiff {
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean };
  target?: { type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean };
}

export interface IndexDiff {
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { columns: string[]; unique: boolean };
  target?: { columns: string[]; unique: boolean };
}

export interface ForeignKeyDiff {
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { columns: string[]; referencedTable: string; referencedColumns: string[] };
  target?: { columns: string[]; referencedTable: string; referencedColumns: string[] };
}

export interface TriggerDiff {
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { timing?: string; event?: string; definition?: string };
  target?: { timing?: string; event?: string; definition?: string };
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
}
