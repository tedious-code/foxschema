export interface Db2TableRaw { TABSCHEMA: string; TABNAME: string; }
export interface Db2ColumnRaw { TABNAME: string; COLNAME: string; COLNO: number; TYPENAME: string; LENGTH: number; SCALE: number; NULLS: 'Y' | 'N'; DEFAULT: string | null; }
export interface Db2PrimaryKeyRaw { TABNAME: string; CONSTNAME: string; COLNAME: string; COLSEQ: number; }
export interface Db2ForeignKeyRaw { TABNAME: string; CONSTNAME: string; COLNAME: string; REFTABSCHEMA: string; REFTABNAME: string; }
export interface Db2UniqueConstraintRaw { TABNAME: string; CONSTNAME: string; }
export interface Db2IndexRaw { INDSCHEMA: string; INDNAME: string; TABNAME: string; UNIQUERULE: 'U' | 'D' | 'P'; }
export interface Db2IndexColumnRaw { INDNAME: string; COLNAME: string; COLORDER: 'A' | 'D'; COLSEQ: number; }
export interface Db2ViewRaw { VIEWSCHEMA: string; VIEWNAME: string; TEXT: string; }
export interface Db2TriggerRaw { TRIGSCHEMA: string; TRIGNAME: string; TABNAME: string; TEXT: string; }
export interface Db2ProcedureRaw { ROUTINESCHEMA: string; ROUTINENAME: string; ROUTINETYPE: 'F' | 'P'; TEXT?: string | null; }
export interface Db2SequenceRaw { SEQSCHEMA: string; SEQNAME: string; }