import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildConnectionString, withConnectionString } from '../../backend/cores/connection-string';
import { CompareModule } from '../../backend/modules/compare.module';
import { SqlGeneratorModule } from '../../backend/modules/sql-generator.module';
import { DbObjectType, ConnectionOptions, SavedConnection, DriverInfo } from '../../backend/interfaces/schema-provider.interface';
import { SchemaCompareResult, TableDiff } from '../../backend/types/diff.types';
import { testConnection as apiTestConnection, fetchTables, fetchSchemaList, executeMigration, checkDriver as apiCheckDriver, installDriver as apiInstallDriver } from '../api/schemaApi';

export interface MigrationProgressItem {
  objectName: string;
  objectType: string;
  action: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  error?: string;
}

const compareModule = new CompareModule();
const sqlGeneratorModule = new SqlGeneratorModule();

interface ConnectionConfig {
  dialect: 'postgres' | 'mysql' | 'db2';
  option: ConnectionOptions;
  schema: string;
}

interface SyncState {
  sourceConfig: ConnectionConfig;
  targetConfig: ConnectionConfig;
  
  connections: SavedConnection[];
  selectedSourceConnectionId: string | null;
  selectedTargetConnectionId: string | null;

  showConnectionModal: boolean;
  editingConnection: SavedConnection | null;

  addConnection: (conn: SavedConnection) => void;
  removeConnection: (id: string) => void;

  setShowConnectionModal: (open: boolean) => void;
  setEditingConnection: (conn: SavedConnection | null) => void;

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
  filterStatus: 'ALL' | 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  searchTerm: string;

  // Per-object inclusion in the deployment script (keyed by tableName)
  syncSelection: Record<string, boolean>;
  toggleSyncSelection: (tableName: string) => void;
  setAllSyncSelection: (selected: boolean) => void;

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
  editingConnection: null,

  sourceDriverInfo: null,
  targetDriverInfo: null,
  isInstallingDriver: null,

  isTestingSource: false,
  isTestingTarget: false,
  sourceConnected: false,
  targetConnected: false,
  errorMsg: null,
  sourceSchemaList: [],
  targetSchemaList: [],

  selectedObjectTypes: ['TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'SEQUENCE', 'TYPE'],
  isComparing: false,
  compareResult: null,
  selectedTable: null,
  generatedSql: null,
  migrationExecuted: false,
  filterStatus: 'ALL',
  searchTerm: '',
  syncSelection: {},

  isMigrating: false,
  migrationProgress: [],
  snapshotDdl: null,
  migrationError: null,
  migrationRolledBack: false,

  // --- Actions ---
  addConnection: (conn) =>
    set((state) => {
      // Same name + dialect means an update of the saved entry, not a duplicate
      const existing = state.connections.find(
        (c) => c.name === conn.name && c.dialect === conn.dialect
      );
      return {
        connections: existing
          ? state.connections.map((c) => (c.id === existing.id ? { ...conn, id: existing.id } : c))
          : [...state.connections, conn],
      };
    }),

  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      selectedSourceConnectionId:
        state.selectedSourceConnectionId === id ? null : state.selectedSourceConnectionId,
      selectedTargetConnectionId:
        state.selectedTargetConnectionId === id ? null : state.selectedTargetConnectionId,
    })),

  setShowConnectionModal: (showConnectionModal) => set({ showConnectionModal }),
  setEditingConnection: (editingConnection) => set({ editingConnection }),
  setSelectedSourceConnection: (id) => set({ selectedSourceConnectionId: id }),
  setSelectedTargetConnection: (id) => set({ selectedTargetConnectionId: id }),

  applySavedConnection: (side, id) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;
    if (side === 'source') {
      set({
        selectedSourceConnectionId: id,
        sourceConfig: {
          dialect: conn.dialect,
          option: conn.option ?? {},
          schema: conn.option?.schema || get().sourceConfig.schema,
        },
        sourceConnected: false,
      });
    } else {
      set({
        selectedTargetConnectionId: id,
        targetConfig: {
          dialect: conn.dialect,
          option: conn.option ?? {},
          schema: conn.option?.schema || get().targetConfig.schema,
        },
        targetConnected: false,
      });
    }
    get().checkDrivers();
    // No manual test button anymore — verify the saved connection right away
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
      // The previous comparison was computed in the old direction — clear it
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
    
  setFilterStatus: (filterStatus) => set({ filterStatus }),
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSelectedTable: (selectedTable) => set({ selectedTable }),

  toggleSyncSelection: (tableName) => {
    const { compareResult, syncSelection, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const nextSelection = { ...syncSelection, [tableName]: !syncSelection[tableName] };
    const includedDiffs = compareResult.tables.filter((t) => nextSelection[t.tableName]);
    set({
      syncSelection: nextSelection,
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        targetSchema: targetConfig.schema,
      }),
      migrationExecuted: false,
    });
  },

  setAllSyncSelection: (selected) => {
    const { compareResult, sourceConfig, targetConfig } = get();
    if (!compareResult) return;
    const nextSelection: Record<string, boolean> = {};
    for (const t of compareResult.tables) {
      if (t.status !== 'UNCHANGED') nextSelection[t.tableName] = selected;
    }
    const includedDiffs = compareResult.tables.filter((t) => nextSelection[t.tableName]);
    set({
      syncSelection: nextSelection,
      generatedSql: sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        targetSchema: targetConfig.schema,
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
      const schemas = await fetchSchemaList(cfg.dialect, withConnectionString(cfg.dialect, cfg.option));
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
      const { dialect, option, schema } = get().sourceConfig;
      const fullOption = withConnectionString(dialect, { ...option, schema });
      const success = await apiTestConnection(dialect, fullOption);
      set({
        sourceConfig: { ...get().sourceConfig, option: fullOption },
        sourceConnected: success,
        isTestingSource: false,
      });
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
      const { dialect, option, schema } = get().targetConfig;
      const fullOption = withConnectionString(dialect, { ...option, schema });
      const success = await apiTestConnection(dialect, fullOption);
      set({
        targetConfig: { ...get().targetConfig, option: fullOption },
        targetConnected: success,
        isTestingTarget: false,
      });
      if (success) {
        await get().loadSchemaList('target');
      }
    } catch (e: any) {
      set({ errorMsg: e.message || 'Target connection failed', isTestingTarget: false, targetConnected: false });
    }
  },

  runSchemaComparison: async () => {
    set({ isComparing: true, errorMsg: null, compareResult: null, selectedTable: null, generatedSql: null, migrationExecuted: false });
    try {
      // Re-read the available schemas so the comparison runs against current server state
      await Promise.all([
        get().sourceConnected ? get().loadSchemaList('source') : Promise.resolve(),
        get().targetConnected ? get().loadSchemaList('target') : Promise.resolve(),
      ]);

      // Read configs after the refresh — it may have re-resolved the selected schema
      const { sourceConfig, targetConfig, selectedObjectTypes } = get();

      let sourceSchemas = await fetchTables(
        sourceConfig.dialect,
        withConnectionString(sourceConfig.dialect, sourceConfig.option),
        sourceConfig.schema
      );
      let targetSchemas = await fetchTables(
        targetConfig.dialect,
        withConnectionString(targetConfig.dialect, targetConfig.option),
        targetConfig.schema
      );

      sourceSchemas = sourceSchemas.filter(s => selectedObjectTypes.includes(s.objectType));
      targetSchemas = targetSchemas.filter(t => selectedObjectTypes.includes(t.objectType));

      const diffResult = await compareModule.compare(sourceSchemas, targetSchemas);

      // Every changed object is included in the deployment by default
      const syncSelection: Record<string, boolean> = {};
      for (const t of diffResult.tables) {
        if (t.status !== 'UNCHANGED') syncSelection[t.tableName] = true;
      }
      const includedDiffs = diffResult.tables.filter((t) => syncSelection[t.tableName]);
      const sql = sqlGeneratorModule.generateMigrationSql(includedDiffs, targetConfig.dialect, {
        sourceSchema: sourceConfig.schema,
        targetSchema: targetConfig.schema,
      });

      set({
        compareResult: diffResult,
        syncSelection,
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
      targetSchema: targetConfig.schema,
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

    try {
      await executeMigration(
        targetConfig.dialect,
        withConnectionString(targetConfig.dialect, { ...targetConfig.option, schema: targetConfig.schema }),
        targetConfig.schema,
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
      version: 3,
      // Persist saved connections and the active configs only — never runtime/compare state
      partialize: (state) => ({
        connections: state.connections,
        sourceConfig: state.sourceConfig,
        targetConfig: state.targetConfig,
        selectedSourceConnectionId: state.selectedSourceConnectionId,
        selectedTargetConnectionId: state.selectedTargetConnectionId,
        selectedObjectTypes: state.selectedObjectTypes,
      }),
      migrate: (persisted: any, version) => {
        const ensure = (type: string) => {
          if (Array.isArray(persisted?.selectedObjectTypes) && !persisted.selectedObjectTypes.includes(type)) {
            persisted.selectedObjectTypes = [...persisted.selectedObjectTypes, type];
          }
        };
        // v2 added TRIGGER; v3 added SEQUENCE and TYPE — enable them once for older settings
        if (version < 2) ensure('TRIGGER');
        if (version < 3) { ensure('SEQUENCE'); ensure('TYPE'); }
        return persisted;
      },
    }
  )
);