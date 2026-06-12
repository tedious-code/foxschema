export type DbObjectType = 'TABLE' | 'VIEW' | 'FUNCTION' | 'PROCEDURE' | 'TRIGGER';

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

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
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

export interface TableSchema {
  name: string;
  objectType: DbObjectType;
  definition?: string;
  columns: ColumnInfo[];
  indices: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKey?: PrimaryKeyInfo;
  triggers?: TriggerInfo[];
}

export interface CompareResult<T> {
  added: T[];
  removed: T[];
  modified: Array<{ source: T; target: T; differences: string[] }>;
}

export interface DbSchema {
  tables: Record<string, DbTable>;
  columns: Record<string, DbColumn[]>;
  functions: Record<string, DbProcedure[]>; 
  procedures: Record<string, DbProcedure[]>;
  triggers: Record<string, DbTrigger[]>;
  sequences: Record<string, DbSequence[]>;
  primaryKeys: Record<string, DbPrimaryKey[]>;
  foreignKeys: Record<string, DbForeignKey[]>;
  views: Record<string, DbView[]>;
  uniqueConstraints: Record<string, DbUniqueConstraint[]>;
  indexes: Record<string, DbIndex[]>;
  indexColumns: Record<string, DbIndexColumn[]>;
}

export interface DbTable {
  name: string;
  columns: Record<string, DbColumn>;
  primaryKey: string[];
  foreignKeys: DbForeignKey[];
  uniqueConstraints: DbUniqueConstraint[];
  indexes: DbIndex[];
}

export interface DbColumn { name: string; type: string; length?: number; scale?: number; nullable: boolean; defaultValue?: string; }
export interface DbForeignKey { name: string; columns: string[]; referencedSchema: string; referencedTable: string; }
export interface DbPrimaryKey { name: string; constName: string; column: string; colSeq: number; }
export interface DbUniqueConstraint { name: string; columns: string[]; }
export interface DbIndex { name: string; uniqueRule: string; columns: string[]; }
export interface DbIndexColumn { name: string; colName: string; colOrder: 'A' | 'D'; colSeq: number; }
export interface DbView { name: string; schema: string; definition: string; columns: Record<string, DbColumn>; indexes: DbIndex[]; }
export interface DbTrigger { name: string; schema: string; tableName: string; event: string; timing: string; definition: string; }
export interface DbProcedure { name: string; schema: string; routineType: string; specificName?: string; definition?: string; }
export interface DbSequence { name: string; schema: string; startValue?: number; increment?: number; minValue?: number; maxValue?: number; cycle?: boolean; }