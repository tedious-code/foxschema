export type DbObjectType = 'TABLE' | 'VIEW' | 'FUNCTION' | 'PROCEDURE' | 'TRIGGER' | 'SEQUENCE' | 'TYPE';

export interface SequenceInfo {
  dataType?: string;
  start?: string;
  increment?: string;
  minValue?: string;
  maxValue?: string;
  cycle?: boolean;
  cache?: number;
}

export interface TypeAttributeInfo {
  name: string;
  type: string;
}

export interface UserTypeInfo {
  /** Underlying built-in type a DISTINCT/user-defined type maps to. */
  sourceType?: string;
  metaType?: string;
  /** Member attributes for structured types. */
  attributes?: TypeAttributeInfo[];
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

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  /** GENERATED ... AS IDENTITY column. */
  identity?: boolean;
  /** 'ALWAYS' | 'BY DEFAULT' when identity. */
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

export interface TableSchema {
  name: string;
  objectType: DbObjectType;
  definition?: string;
  columns: ColumnInfo[];
  indices: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKey?: PrimaryKeyInfo;
  triggers?: TriggerInfo[];
  /** Present when objectType === 'SEQUENCE'. */
  sequence?: SequenceInfo;
  /** Present when objectType === 'TYPE'. */
  userType?: UserTypeInfo;
}

export interface DbSchema {
  tables: Record<string, DbTable>;
  columns: Record<string, DbColumn[]>;
  functions: Record<string, DbProcedure[]>; 
  procedures: Record<string, DbProcedure[]>;
  triggers: Record<string, DbTrigger[]>;
  sequences: Record<string, DbSequence[]>;
  userTypes: Record<string, DbUserType[]>;
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

export interface DbColumn { name: string; type: string; length?: number; scale?: number; nullable: boolean; defaultValue?: string; identity?: boolean; identityGeneration?: string; }
export interface DbForeignKey { name: string; columns: string[]; referencedSchema: string; referencedTable: string; }
export interface DbPrimaryKey { name: string; constName: string; column: string; colSeq: number; }
export interface DbUniqueConstraint { name: string; columns: string[]; }
export interface DbIndex { name: string; uniqueRule: string; columns: string[]; }
export interface DbIndexColumn { name: string; colName: string; colOrder: 'A' | 'D'; colSeq: number; }
export interface DbView { name: string; schema: string; definition: string; columns: Record<string, DbColumn>; indexes: DbIndex[]; }
export interface DbTrigger { name: string; schema: string; tableName: string; event: string; timing: string; definition: string; }
export interface DbProcedure { name: string; schema: string; routineType: string; specificName?: string; definition?: string; }
export interface DbSequence { name: string; schema: string; dataType?: string; startValue?: string; increment?: string; minValue?: string; maxValue?: string; cycle?: boolean; cache?: number; }
export interface DbUserType { name: string; schema: string; sourceType?: string; metaType?: string; attributes?: { name: string; type: string }[]; }