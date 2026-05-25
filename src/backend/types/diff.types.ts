import { TableSchema } from '../interfaces/schema-provider.interface';

export type DiffType = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface ColumnDiff {
  name: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  source?: { type: string; nullable: boolean; defaultValue?: string };
  target?: { type: string; nullable: boolean; defaultValue?: string };
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

export interface TableDiff {
  tableName: string;
  objectType: 'TABLE' | 'VIEW' | 'FUNCTION' | 'PROCEDURE';
  status: DiffType;
  definition?: string;
  columnDiffs: ColumnDiff[];
  indexDiffs: IndexDiff[];
  foreignKeyDiffs: ForeignKeyDiff[];
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
