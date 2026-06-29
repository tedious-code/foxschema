import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SqlGeneratorModule } from '../lib/sql-generator';
import { buildConnectionString, withConnectionString, type ConnectionOptions } from '../lib/provider-settings';
import type { DbObjectType, DriverInfo, SchemaCompareResult, TableDiff } from '../lib/types';
import {
  testConnection as apiTestConnection,
  fetchSchemaList,
  compareSchemas,
  executeMigration,
  checkDriver as apiCheckDriver,
  installDriver as apiInstallDriver,
  invalidateCache,
  type ConnectionRef,
} from '../api/schemaApi';
import {
  apiListConnections,
  apiCreateConnection,
  apiUpdateConnection,
  apiDeleteConnection,
  type SavedConnectionSummary,
} from '../api/authApi';

export interface MigrationProgressItem {
  objectName: string;
  objectType: string;
  action: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  error?: string;
}

// Comparison runs server-side (/api/compare); SQL generation stays client-side
// because it re-runs interactively as deploy checkboxes toggle, with no DB round-trip
const sqlGeneratorModule = new SqlGeneratorModule();

// Build the diffs to deploy from the object selection, applying per-role member
// opt-outs: a role member explicitly set to false is dropped from the role's
// diffs, so it won't appear in the generated GRANT/REVOKE.
function buildIncludedDiffs(
  tables: TableDiff[],
  selection: Record<string, boolean>,
  memberSelection: Record<string, Record<string, boolean>>
): TableDiff[] {
  return tables
    .filter((t) => selection[t.tableName])
    .map((t) => {
      if (t.objectType !== 'ROLE') return t;
      const sel = memberSelection[t.tableName] ?? {};
      return { ...t, columnDiffs: t.columnDiffs.filter((c) => sel[c.name] !== false) };
    });
}

interface ConnectionConfig {
  dialect: 'postgres' | 'mysql' | 'db2';
  option: ConnectionOptions;
  schema: string;
  /** Set when this side uses a saved server connection — no password held client-side. */
  connectionId?: string;
}

/**
 * A side's request payload: a saved connection (connectionId, resolved+decrypted
 * server-side) or an inline ad-hoc option. Keeps passwords off the wire for saved ones.
 */
function buildRef(cfg: ConnectionConfig): ConnectionRef {
  if (cfg.connectionId) return { connectionId: cfg.connectionId, schema: cfg.schema };
  return {
    dialect: cfg.dialect,
    option: withConnectionString(cfg.dialect, { ...cfg.option, schema: cfg.schema }),
    schema: cfg.schema,
  };
}

interface SyncState {
  sourceConfig: ConnectionConfig;
  targetConfig: ConnectionConfig;
  
  connections: SavedConnectionSummary[];
  selectedSourceConnectionId: string | null;
  selectedTargetConnectionId: string | null;

  showConnectionModal: boolean;

  loadConnections: () => Promise<void>;
  addConnection: (input: { name?: string; dialect: string; schema?: string; option: ConnectionOptions }) => Promise<SavedConnectionSummary>;
  updateConnection: (id: string, input: { name?: string; dialect: string; schema?: string; option: ConnectionOptions }) => Promise<SavedConnectionSummary>;
  removeConnection: (id: string) => Promise<void>;

  setShowConnectionModal: (open: boolean) => void;

  setSelectedSourceConnection: (id: string | null) => void;
  setSelectedTargetConnection: (id: string | null) => void;
  applySavedConnection: (side: 'source' | 'target', id: string) => void;

  sourceDriverInfo: DriverInfo | null;
  targetDriverInfo: DriverInfo | null;
  isInstallingDriver: string | null;
  checkDrivers: () => Promise<void>;
  installDriver: (target: 'source' | 'target') => Promise<void>;

  isTestingSource: boolean;
  isTestingTarget: boolean;
  sourceConnected: boolean;
  targetConnected: boolean;
  errorMsg: string | null;
  /** Non-fatal notices from the last comparison (e.g. roles skipped — no privilege). */
  warnings: string[];

  // Schemas available on each connected database (loaded after a successful test)
  sourceSchemaList: string[];
  targetSchemaList: string[];
  loadSchemaList: (side: 'source' | 'target') => Promise<void>;
  setSchema: (side: 'source' | 'target', schema: string) => void;

  // Selected Object Scope selection filters
  selectedObjectTypes: DbObjectType[];

  isComparing: boolean;
  compareResult: SchemaCompareResult | null;
  selectedTable: TableDiff | null;
  generatedSql: string | null;
  migrationExecuted: boolean;
  /** Additive mode: generate ADD/MODIFY only — never DROP anything in the target. */
  nonDestructive: boolean;
  setNonDestructive: (v: boolean) => void;
  filterStatus: 'ALL' | 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  searchTerm: string;

  // Per-object inclusion in the deployment script (keyed by tableName)
  syncSelection: Record<string, boolean>;
  toggleSyncSelection: (tableName: string) => void;
  setAllSyncSelection: (selected: boolean) => void;
  /** Per-role member opt-out: memberSelection[role][member] === false excludes that member from deploy. */
  memberSelection: Record<string, Record<string, boolean>>;
  toggleMemberSelection: (roleName: string, memberName: string) => void;
  setAllMemberSelection: (roleName: string, selected: boolean) => void;

  // Live migration execution state
  isMigrating: boolean;
  migrationProgress: MigrationProgressItem[];
  snapshotDdl: string | null;
  migrationError: string | null;
  migrationRolledBack: boolean;
  clearMigrationProgress: () => void;

  setSourceConfig: (cfg: Partial<ConnectionConfig>) => void;
  setTargetConfig: (cfg: Partial<ConnectionConfig>) => void;
  swapSourceTarget: () => void;
  toggleObjectTypeFilter: (type: DbObjectType) => void;
  setFilterStatus: (status: 'ALL' | 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED') => void;
  setSearchTerm: (term: string) => void;
  setSelectedTable: (table: TableDiff | null) => void;

  generateConnectionString: (side: 'source' | 'target') => string;
  testSourceConnection: () => Promise<void>;
  testTargetConnection: () => Promise<void>;
  runSchemaComparison: () => Promise<void>;
  applyMigration: () => Promise<void>;
  resetSync: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
  // --- Initial States ---
  sourceConfig: {
    dialect: 'postgres',
    option: {
      connectionString: 'put your connection string here',
    },
    schema: 'public',
  },
  targetConfig: {
    dialect: 'postgres',
    option: {
      connectionString: 'put your connection string here',
    },
    schema: 'public',
  },
  
  connections: [],
  selectedSourceConnectionId: null,
  selectedTargetConnectionId: null,
  showConnectionModal: false,

  sourceDriverInfo: null,
  targetDriverInfo: null,
  isInstallingDriver: null,

  isTestingSource: false,
  isTestingTarget: false,
  sourceConnected: false,
  targetConnected: false,
  errorMsg: null,
  warnings: [],
  sourceSchemaList: [],
  targetSchemaList: [],

  selectedObjectTypes: ['TABLE', 'MQT', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'SEQUENCE', 'TYPE', 'ROLE'],
  isComparing: false,
  compareResult: null,
  selectedTable: null,
  generatedSql: null,
  migrationExecuted: false,
  nonDestructive: false,
  filterStatus: 'ALL',
  searchTerm: '',
  memberSelection: {},
  syncSelection: {},

  isMigrating: false,
  migrationProgress: [],
  snapshotDdl: null,
  migrationError: null,
  migrationRolledBack: false,

  // --- Actions ---
  loadConnections: async () => {
    try {
      set({ connections: await apiListConnections() });
    } catch (e) {
      console.error('Failed to load saved connections:', e);
    }
  },

  addConnection: async (input) => {
    // Credentials are encrypted server-side; only metadata returns to the client
    const created = await apiCreateConnection(input);
    await get().loadConnections();
    return created;
  },

  updateConnection: async (id, input) => {
    const updated = await apiUpdateConnection(id, input);
    await get().loadConnections();
    return updated;
  },

  removeConnection: async (id) => {
    await apiDeleteConnection(id);
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      selectedSourceConnectionId: state.selectedSourceConnectionId === id ? null : state.selectedSourceConnectionId,
      selectedTargetConnectionId: state.selectedTargetConnectionId === id ? null : state.selectedTargetConnectionId,
    }));
  },

  setShowConnectionModal: (showConnectionModal) => set({ showConnectionModal }),
  setSelectedSourceConnection: (id) => set({ selectedSourceConnectionId: id }),
  setSelectedTargetConnection: (id) => set({ selectedTargetConnectionId: id }),

  applySavedConnection: (side, id) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;
    // Use the saved connection by id — no password is held in the browser.
    // Carry the non-secret fields so the edit form prefills them.
    const config: ConnectionConfig = {
      dialect: conn.dialect as ConnectionConfig['dialect'],
      option: {
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        schema: conn.schema,
      },
      schema: conn.schema ?? '',
      connectionId: id,
    };
    if (side === 'source') {
      set({ selectedSourceConnectionId: id, sourceConfig: config, sourceConnected: false });
    } else {
      set({ selectedTargetConnectionId: id, targetConfig: config, targetConnected: false });
    }
    get().checkDrivers();
    // Verify the saved connection right away
    void (side === 'source' ? get().testSourceConnection() : get().testTargetConnection());
  },

  setSourceConfig: (cfg) => {
    set((state) => ({ sourceConfig: { ...state.sourceConfig, ...cfg }, sourceConnected: false }));
    get().checkDrivers();
  },
  setTargetConfig: (cfg) => {
    set((state) => ({ targetConfig: { ...state.targetConfig, ...cfg }, targetConnected: false }));
    get().checkDrivers();
  },

  // Flip migration direction: what was the source becomes the target and vice versa
  swapSourceTarget: () => {
    const s = get();
    set({
      sourceConfig: s.targetConfig,
      targetConfig: s.sourceConfig,
      sourceConnected: s.targetConnected,
      targetConnected: s.sourceConnected,
      sourceSchemaList: s.targetSchemaList,
      targetSchemaList: s.sourceSchemaList,
      sourceDriverInfo: s.targetDriverInfo,
      targetDriverInfo: s.sourceDriverInfo,
      selectedSourceConnectionId: s.selectedTargetConnectionId,
      selectedTargetConnectionId: s.selectedSourceConnectionId,
      compareResult: null,
      selectedTable: null,
      generatedSql: null,
      syncSelection: {},
      migrationExecuted: false,
    });
  },


  toggleObjectTypeFilter: (type) =>
    set((state) => {
      const active = state.selectedObjectTypes;
      const next = active.includes(type)
        ? active.filter((t) => t !== type)
        : [...active, type];
      return { selectedObjectTypes: next };
    }),
    
  setNonDestructive: (nonDestructive) => {
    set({ nonDestructive });
    // Regenerate the script from the current selection so the preview reflects the mode.
    const { compareResult, syncSelection, memberSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const includedDiffs = buildIncludedDiffs(compareResult.tables, syncSelection, memberSelection);
    set({
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        sourceDialect: sourceConfig.dialect,
        targetSchema: targetConfig.schema,
        nonDestructive,
      }),
      migrationExecuted: false,
    });
  },

  setFilterStatus: (filterStatus) => set({ filterStatus }),
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSelectedTable: (selectedTable) => set({ selectedTable }),

  toggleSyncSelection: (tableName) => {
    const { compareResult, syncSelection, memberSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const nextSelection = { ...syncSelection, [tableName]: !syncSelection[tableName] };
    const includedDiffs = buildIncludedDiffs(compareResult.tables, nextSelection, memberSelection);
    set({
      syncSelection: nextSelection,
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        sourceDialect: sourceConfig.dialect,
        targetSchema: targetConfig.schema,
        nonDestructive: get().nonDestructive,
      }),
      migrationExecuted: false,
    });
  },

  setAllSyncSelection: (selected) => {
    const { compareResult, memberSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const nextSelection: Record<string, boolean> = {};
    for (const t of compareResult.tables) {
      if (t.status !== 'UNCHANGED') nextSelection[t.tableName] = selected;
    }
    const includedDiffs = buildIncludedDiffs(compareResult.tables, nextSelection, memberSelection);
    set({
      syncSelection: nextSelection,
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        sourceDialect: sourceConfig.dialect,
        targetSchema: targetConfig.schema,
        nonDestructive: get().nonDestructive,
      }),
      migrationExecuted: false,
    });
  },

  toggleMemberSelection: (roleName, memberName) => {
    const { compareResult, syncSelection, memberSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const roleSel = { ...(memberSelection[roleName] ?? {}) };
    // Default included; toggle to false (excluded) and back.
    roleSel[memberName] = roleSel[memberName] === false ? true : false;
    const nextMember = { ...memberSelection, [roleName]: roleSel };
    const includedDiffs = buildIncludedDiffs(compareResult.tables, syncSelection, nextMember);
    set({
      memberSelection: nextMember,
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        sourceDialect: sourceConfig.dialect,
        targetSchema: targetConfig.schema,
        nonDestructive: get().nonDestructive,
      }),
      migrationExecuted: false,
    });
  },

  setAllMemberSelection: (roleName, selected) => {
    const { compareResult, syncSelection, memberSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const role = compareResult.tables.find((t) => t.tableName === roleName && t.objectType === 'ROLE');
    if (!role) return;
    const roleSel: Record<string, boolean> = {};
    for (const m of role.columnDiffs) {
      if (m.status !== 'UNCHANGED') roleSel[m.name] = selected;
    }
    const nextMember = { ...memberSelection, [roleName]: roleSel };
    const includedDiffs = buildIncludedDiffs(compareResult.tables, syncSelection, nextMember);
    set({
      memberSelection: nextMember,
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        sourceDialect: sourceConfig.dialect,
        targetSchema: targetConfig.schema,
        nonDestructive: get().nonDestructive,
      }),
      migrationExecuted: false,
    });
  },

  checkDrivers: async () => {
    const { sourceConfig, targetConfig } = get();
    try {
      const sourceDriver = await apiCheckDriver(sourceConfig.dialect);
      const targetDriver = await apiCheckDriver(targetConfig.dialect);
      set({ sourceDriverInfo: sourceDriver, targetDriverInfo: targetDriver });
    } catch (e) {
      console.error('Error checking drivers:', e);
    }
  },

  installDriver: async (target) => {
    const dialect = target === 'source' ? get().sourceConfig.dialect : get().targetConfig.dialect;
    set({ isInstallingDriver: dialect, errorMsg: null });
    try {
      const result = await apiInstallDriver(dialect);
      if (result.success) {
        await get().checkDrivers();
      } else {
        set({ errorMsg: result.error || `Failed to install driver for ${dialect}` });
      }
    } catch (e: any) {
      set({ errorMsg: e.message || `Failed to install driver for ${dialect}` });
    } finally {
      set({ isInstallingDriver: null });
    }
  },

  generateConnectionString: (side) => {
    const { dialect, option } = side === 'source' ? get().sourceConfig : get().targetConfig;
    return option.connectionString?.trim() || buildConnectionString(dialect, option);
  },

  loadSchemaList: async (side) => {
    const cfg = side === 'source' ? get().sourceConfig : get().targetConfig;
    try {
      const schemas = await fetchSchemaList(buildRef(cfg));
      // Keep the configured schema if the server has it (case-insensitive), else fall back to the first
      const current = cfg.schema || '';
      const match =
        schemas.find((s) => s === current) ??
        schemas.find((s) => s.toLowerCase() === current.toLowerCase()) ??
        schemas[0] ??
        current;
      if (side === 'source') {
        set({ sourceSchemaList: schemas, sourceConfig: { ...get().sourceConfig, schema: match } });
      } else {
        set({ targetSchemaList: schemas, targetConfig: { ...get().targetConfig, schema: match } });
      }
    } catch (e) {
      console.error(`Failed to load schema list for ${side}:`, e);
    }
  },

  setSchema: (side, schema) => {
    // Schema switch keeps the connection valid — only the comparison scope changes
    if (side === 'source') {
      set({ sourceConfig: { ...get().sourceConfig, schema }, compareResult: null, selectedTable: null, generatedSql: null, syncSelection: {} });
    } else {
      set({ targetConfig: { ...get().targetConfig, schema }, compareResult: null, selectedTable: null, generatedSql: null, syncSelection: {} });
    }
  },

  testSourceConnection: async () => {
    set({ isTestingSource: true, errorMsg: null });
    try {
      // Explicit (re)connect — drop cached schema lists so the refresh is live
      invalidateCache('schemas:');
      const success = await apiTestConnection(buildRef(get().sourceConfig));
      set({ sourceConnected: success, isTestingSource: false });
      if (success) {
        await get().loadSchemaList('source');
      }
    } catch (e: any) {
      set({ errorMsg: e.message || 'Source connection failed', isTestingSource: false, sourceConnected: false });
    }
  },

  testTargetConnection: async () => {
    set({ isTestingTarget: true, errorMsg: null });
    try {
      // Explicit (re)connect — drop cached schema lists so the refresh is live
      invalidateCache('schemas:');
      const success = await apiTestConnection(buildRef(get().targetConfig));
      set({ targetConnected: success, isTestingTarget: false });
      if (success) {
        await get().loadSchemaList('target');
      }
    } catch (e: any) {
      set({ errorMsg: e.message || 'Target connection failed', isTestingTarget: false, targetConnected: false });
    }
  },

  runSchemaComparison: async () => {
    set({ isComparing: true, errorMsg: null, warnings: [], compareResult: null, selectedTable: null, generatedSql: null, migrationExecuted: false });
    try {
      // Re-read the available schemas so the comparison runs against current server state
      await Promise.all([
        get().sourceConnected ? get().loadSchemaList('source') : Promise.resolve(),
        get().targetConnected ? get().loadSchemaList('target') : Promise.resolve(),
      ]);

      // Read configs after the refresh — it may have re-resolved the selected schema
      const { sourceConfig, targetConfig, selectedObjectTypes } = get();

      // Load + diff both schemas on the server; only the result comes back
      const diffResult = await compareSchemas(buildRef(sourceConfig), buildRef(targetConfig), selectedObjectTypes);

      // Nothing is auto-selected — the user opts objects into the deployment
      const sql = sqlGeneratorModule.generateMigrationSql([], targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        sourceDialect: sourceConfig.dialect,
        targetSchema: targetConfig.schema,
        nonDestructive: get().nonDestructive,
      });

      set({
        compareResult: diffResult,
        warnings: diffResult.warnings ?? [],
        syncSelection: {},
        generatedSql: sql,
        selectedTable: diffResult.tables[0] || null,
        isComparing: false,
      });
    } catch (e: any) {
      set({ errorMsg: e.message || 'Schema comparison encountered an error', isComparing: false });
    }
  },

  clearMigrationProgress: () =>
    set({ migrationProgress: [], snapshotDdl: null, migrationError: null, migrationRolledBack: false }),

  applyMigration: async () => {
    const { compareResult, syncSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;

    const includedDiffs = compareResult.tables.filter((t) => syncSelection[t.tableName]);
    const plan = sqlGeneratorModule.generateMigrationPlan(includedDiffs, targetConfig.dialect, {
      sourceSchema: sourceConfig.schema,
      sourceDialect: sourceConfig.dialect,
      targetSchema: targetConfig.schema,
      nonDestructive: get().nonDestructive,
    });
    if (plan.length === 0) return;

    set({
      isMigrating: true,
      migrationError: null,
      migrationRolledBack: false,
      snapshotDdl: null,
      migrationProgress: plan.map((s) => ({
        objectName: s.objectName,
        objectType: s.objectType,
        action: s.action,
        status: 'PENDING' as const,
      })),
    });

    let migrationSucceeded = false;
    try {
      await executeMigration(
        buildRef(targetConfig),
        plan,
        (event) => {
          if (event.type === 'snapshot') {
            set({ snapshotDdl: event.ddl });
          } else if (event.type === 'object') {
            set({
              migrationProgress: get().migrationProgress.map((item) =>
                item.objectName === event.objectName && item.action === event.action
                  ? { ...item, status: event.status, error: event.error }
                  : item
              ),
            });
          } else if (event.type === 'done') {
            migrationSucceeded = event.success && !event.rolledBack;
            set({
              migrationExecuted: event.success,
              migrationError: event.error ?? null,
              migrationRolledBack: event.rolledBack,
            });
          }
        }
      );
    } catch (e: any) {
      set({ migrationError: e.message || 'Migration failed' });
    } finally {
      set({ isMigrating: false });
    }

    // Auto-refresh the comparison so the diff list reflects what was just applied.
    // migrationProgress and migration result state are preserved across the refresh.
    if (migrationSucceeded) {
      await get().runSchemaComparison();
    }
  },

  resetSync: () => {
    set({
      compareResult: null,
      selectedTable: null,
      generatedSql: null,
      migrationExecuted: false,
      syncSelection: {},
    });
  },
    }),
    {
      name: 'schema-sync-storage',
      version: 4,
      // Persist only the object-type scope. Connections live server-side now,
      // and we deliberately do NOT persist configs — credentials must never
      // touch localStorage (saved connections reload from the server on sign-in).
      partialize: (state) => ({
        selectedObjectTypes: state.selectedObjectTypes,
        nonDestructive: state.nonDestructive,
      }),
      migrate: (persisted: any, version) => {
        const ensure = (type: string) => {
          if (Array.isArray(persisted?.selectedObjectTypes) && !persisted.selectedObjectTypes.includes(type)) {
            persisted.selectedObjectTypes = [...persisted.selectedObjectTypes, type];
          }
        };
        // v2 added TRIGGER; v3 added SEQUENCE and TYPE; v4 added MQT and ROLE —
        // enable each once for older persisted settings.
        if (version < 2) ensure('TRIGGER');
        if (version < 3) { ensure('SEQUENCE'); ensure('TYPE'); }
        if (version < 4) { ensure('MQT'); ensure('ROLE'); }
        return persisted;
      },
    }
  )
);