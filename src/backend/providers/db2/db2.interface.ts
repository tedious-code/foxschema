export interface Db2TableRaw { TABSCHEMA: string; TABNAME: string; }
export interface Db2ColumnRaw { TABNAME: string; COLNAME: string; COLNO: number; TYPENAME: string; LENGTH: number; SCALE: number; NULLS: 'Y' | 'N'; DEFAULT: string | null; IDENTITY: 'Y' | 'N'; GENERATED: 'A' | 'D' | ' ' | ''; }
export interface Db2PrimaryKeyRaw { TABNAME: string; CONSTNAME: string; COLNAME: string; COLSEQ: number; }
export interface Db2ForeignKeyRaw { TABNAME: string; CONSTNAME: string; COLNAME: string; REFTABSCHEMA: string; REFTABNAME: string; }
export interface Db2UniqueConstraintRaw { TABNAME: string; CONSTNAME: string; }
export interface Db2IndexRaw { INDSCHEMA: string; INDNAME: string; TABNAME: string; UNIQUERULE: 'U' | 'D' | 'P'; }
export interface Db2IndexColumnRaw { INDNAME: string; COLNAME: string; COLORDER: 'A' | 'D'; COLSEQ: number; }
export interface Db2ViewRaw { VIEWSCHEMA: string; VIEWNAME: string; TEXT: string; }
export interface Db2TriggerRaw { TRIGSCHEMA: string; TRIGNAME: string; TABNAME: string; TRIGTIME: 'B' | 'A' | 'I'; TRIGEVENT: 'I' | 'U' | 'D' | 'M'; TEXT: string; }
export interface Db2ProcedureRaw { ROUTINESCHEMA: string; ROUTINENAME: string; ROUTINETYPE: 'F' | 'P'; TEXT?: string | null; }
export interface Db2SequenceRaw { SEQSCHEMA: string; SEQNAME: string; TYPENAME?: string; START?: string | number; INCREMENT?: string | number; MINVALUE?: string | number; MAXVALUE?: string | number; CYCLE?: 'Y' | 'N'; CACHE?: number; }
export interface Db2UserTypeRaw { TYPESCHEMA: string; TYPENAME: string; SOURCENAME?: string; METATYPE?: string; LENGTH?: number; SCALE?: number; }
export interface Db2AttributeRaw { TYPESCHEMA: string; TYPENAME: string; ATTR_NAME: string; ATTR_TYPENAME: string; LENGTH?: number; SCALE?: number; ORDINAL: number; }