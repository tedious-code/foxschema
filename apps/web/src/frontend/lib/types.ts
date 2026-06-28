// Frontend-local type definitions. Duplicated from packages/core intentionally
// so the frontend bundle has no dependency on Node-only packages.

export type DbObjectType = 'TABLE' | 'MQT' | 'VIEW' | 'FUNCTION' | 'PROCEDURE' | 'TRIGGER' | 'SEQUENCE' | 'TYPE' | 'ROLE';
export type DiffType = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
export type RoutineParameterMode = 'IN' | 'OUT' | 'INOUT' | 'RETURN' | 'RESULT';

export interface RoutineParameter {
  name: string;
  type: string;
  mode: RoutineParameterMode;
  ordinal?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  identity?: boolean;
  identityGeneration?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

export interface PrimaryKeyInfo {
  name?: string;
  columns: string[];
}

export interface TriggerInfo {
  name: string;
  timing?: string;
  event?: string;
  definition?: string;
}

export interface SequenceInfo {
  dataType?: string;
  start?: string;
  increment?: string;
  minValue?: string;
  maxValue?: string;
  cycle?: boolean;
  cache?: number;
}

export interface UserTypeInfo {
  sourceType?: string;
  metaType?: string;
  attributes?: { name: string; type: string }[];
}

export interface TableSchema {
  name: string;
  objectType: DbObjectType;
  definition?: string;
  columns: ColumnInfo[];
  indices: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKey?: PrimaryKeyInfo;
  triggers?: TriggerInfo[];
  sequence?: SequenceInfo;
  userType?: UserTypeInfo;
  parameters?: RoutineParameter[];
  functionKind?: 'scalar' | 'table';
  tablespace?: string;
}

// Diff types
export interface ColumnDiff {
  name: string;
  status: DiffType;
  source?: { type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean };
  target?: { type: string; nullable: boolean; defaultValue?: string; primaryKey?: boolean; identity?: boolean };
}

export interface IndexDiff {
  name: string;
  status: DiffType;
  source?: { columns: string[]; unique: boolean };
  target?: { columns: string[]; unique: boolean };
}

export interface ForeignKeyDiff {
  name: string;
  status: DiffType;
  source?: { columns: string[]; referencedTable: string; referencedColumns: string[] };
  target?: { columns: string[]; referencedTable: string; referencedColumns: string[] };
}

export interface TriggerDiff {
  name: string;
  status: DiffType;
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
  summary: { added: number; removed: number; modified: number; unchanged: number };
}

export interface MigrationStep {
  objectName: string;
  objectType: DbObjectType;
  action: 'DROP' | 'CREATE' | 'ALTER';
  statements: string[];
}

export type MigrationEvent =
  | { type: 'snapshot'; ddl: string }
  | { type: 'start'; total: number }
  | { type: 'object'; objectName: string; objectType: string; action: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED'; error?: string }
  | { type: 'done'; success: boolean; rolledBack: boolean; error?: string };

export interface DriverInfo {
  provider: string;
  packageName: string;
  installed: boolean;
  version?: string;
  installCommand?: string;
  error?: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  dialect: string;
  option?: {
    host?: string;
    port?: number;
    database?: string;
    schema?: string;
    username?: string;
    [key: string]: unknown;
  };
}
