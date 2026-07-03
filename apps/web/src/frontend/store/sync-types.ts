import type { ConnectionOptions, Dialect } from '../lib/provider-settings';
import type { DbObjectType, SchemaCompareResult, TableDiff } from '../lib/types';
import type { SavedConnectionSummary } from '../api/authApi';

export interface MigrationProgressItem {
  objectName: string;
  objectType: string;
  action: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error?: string;
}

export interface ConnectionConfig {
  dialect: Dialect;
  option: ConnectionOptions;
  schema: string;
  /** Set when this side uses a saved server connection — no password held client-side. */
  connectionId?: string;
}

export type FilterStatus = 'ALL' | 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
export type Side = 'source' | 'target';

/**
 * The sync workspace store. Groups, in order: connection management, connection
 * test + schema-list state, the object-scope/compare/browse state, deploy
 * selection + generated SQL, and live migration execution.
 */
export interface SyncState {
  // --- Connections -------------------------------------------------------
  sourceConfig: ConnectionConfig;
  targetConfig: ConnectionConfig;

  connections: SavedConnectionSummary[];
  selectedSourceConnectionId: string | null;
  selectedTargetConnectionId: string | null;

  showConnectionModal: boolean;

  loadConnections: () => Promise<void>;
  addConnection: (input: { name?: string; dialect: string; schema?: string; option: ConnectionOptions; savePassword?: boolean }) => Promise<SavedConnectionSummary>;
  updateConnection: (id: string, input: { name?: string; dialect: string; schema?: string; option: ConnectionOptions; savePassword?: boolean }) => Promise<SavedConnectionSummary>;
  removeConnection: (id: string) => Promise<void>;

  setShowConnectionModal: (open: boolean) => void;

  setSelectedSourceConnection: (id: string | null) => void;
  setSelectedTargetConnection: (id: string | null) => void;
  applySavedConnection: (side: Side, id: string, sessionPassword?: string) => void;

  // --- Connection test + schema list ------------------------------------
  isTestingSource: boolean;
  isTestingTarget: boolean;
  sourceConnected: boolean;
  targetConnected: boolean;
  /** Server version string detected at connection time (e.g. "19.3.0" for Oracle 19c). */
  sourceServerVersion: string | undefined;
  targetServerVersion: string | undefined;
  errorMsg: string | null;
  /** Non-fatal notices from the last comparison (e.g. roles skipped — no privilege). */
  warnings: string[];
  dismissWarnings: () => void;

  // Schemas available on each connected database (loaded after a successful test)
  sourceSchemaList: string[];
  targetSchemaList: string[];
  loadSchemaList: (side: Side) => Promise<void>;
  setSchema: (side: Side, schema: string) => void;

  // --- Object scope / compare / browse ----------------------------------
  selectedObjectTypes: DbObjectType[];

  isComparing: boolean;
  compareResult: SchemaCompareResult | null;
  /** Browse mode: compareResult holds one loaded schema (no diff) for search/inspection. */
  browseMode: boolean;
  browseSide: Side | null;
  isBrowsing: boolean;
  browseSchema: (side: Side) => Promise<void>;
  selectedTable: TableDiff | null;
  generatedSql: string | null;
  migrationExecuted: boolean;
  /** Additive mode: generate ADD/MODIFY only — never DROP anything in the target. */
  nonDestructive: boolean;
  setNonDestructive: (v: boolean) => void;
  filterStatus: FilterStatus;
  searchTerm: string;

  // --- Deploy selection -------------------------------------------------
  // Per-object inclusion in the deployment script (keyed by tableName)
  syncSelection: Record<string, boolean>;
  toggleSyncSelection: (tableName: string) => void;
  setAllSyncSelection: (selected: boolean) => void;
  /** Per-role member opt-out: memberSelection[role][member] === false excludes that member from deploy. */
  memberSelection: Record<string, Record<string, boolean>>;
  toggleMemberSelection: (roleName: string, memberName: string) => void;
  setAllMemberSelection: (roleName: string, selected: boolean) => void;

  // --- Live migration execution -----------------------------------------
  isMigrating: boolean;
  migrationProgress: MigrationProgressItem[];
  snapshotDdl: string | null;
  migrationError: string | null;
  migrationRolledBack: boolean;
  clearMigrationProgress: () => void;
  /** Deselect a failed object and re-run the migration with the remaining selection. */
  skipObjectAndRetry: (objectName: string) => Promise<void>;

  setSourceConfig: (cfg: Partial<ConnectionConfig>) => void;
  setTargetConfig: (cfg: Partial<ConnectionConfig>) => void;
  swapSourceTarget: () => void;
  toggleObjectTypeFilter: (type: DbObjectType) => void;
  setFilterStatus: (status: FilterStatus) => void;
  setSearchTerm: (term: string) => void;
  setSelectedTable: (table: TableDiff | null) => void;

  testSourceConnection: () => Promise<void>;
  testTargetConnection: () => Promise<void>;
  runSchemaComparison: () => Promise<void>;
  applyMigration: () => Promise<void>;
  resetSync: () => void;
}
