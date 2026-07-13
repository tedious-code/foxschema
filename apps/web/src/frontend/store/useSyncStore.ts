import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildBrowseResult } from '../lib/browse';
import type { ConnectionOptions } from '../lib/provider-settings';
import {
  testConnection as apiTestConnection,
  fetchSchemaList,
  compareSchemas,
  loadSchema,
  executeMigration,
  invalidateCache,
} from '../api/schemaApi';
import {
  apiListConnections,
  apiCreateConnection,
  apiUpdateConnection,
  apiDeleteConnection,
} from '../api/authApi';
import type { ConnectionConfig, SyncState } from './sync-types';
import { sqlGeneratorModule, buildRef, buildMapping, regenerateSql } from './sync-helpers';

export type { MigrationProgressItem } from './sync-types';

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

  isTestingSource: false,
  isTestingTarget: false,
  sourceConnected: false,
  targetConnected: false,
  sourceServerVersion: undefined,
  targetServerVersion: undefined,
  errorMsg: null,
  warnings: [],
  sourceSchemaList: [],
  targetSchemaList: [],

  selectedObjectTypes: ['TABLE', 'MQT', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'SEQUENCE', 'TYPE', 'ROLE'],
  isComparing: false,
  compareResult: null,
  browseMode: false,
  browseSide: null,
  isBrowsing: false,
  selectedTable: null,
  generatedSql: null,
  migrationExecuted: false,
  nonDestructive: false,
  continueOnError: false,
  filterStatus: 'ALL',
  searchTerm: '',
  typeFilter: [],
  memberSelection: {},
  indexSelection: {},
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

  applySavedConnection: (side, id, sessionPassword) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;
    // Use the saved connection by id — no password is held in the browser, EXCEPT an
    // optional session password (for connections stored without one) kept in-memory only.
    const config: ConnectionConfig = {
      dialect: conn.dialect as ConnectionConfig['dialect'],
      option: {
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        schema: conn.schema,
        ...(sessionPassword ? { password: sessionPassword } : {}),
      },
      schema: conn.schema ?? '',
      connectionId: id,
    };
    if (side === 'source') {
      set({ selectedSourceConnectionId: id, sourceConfig: config, sourceConnected: false });
    } else {
      set({ selectedTargetConnectionId: id, targetConfig: config, targetConnected: false });
    }
    // Verify the saved connection right away
    void (side === 'source' ? get().testSourceConnection() : get().testTargetConnection());
  },

  setSourceConfig: (cfg) => {
    set((state) => ({ sourceConfig: { ...state.sourceConfig, ...cfg }, sourceConnected: false }));
  },
  setTargetConfig: (cfg) => {
    set((state) => ({ targetConfig: { ...state.targetConfig, ...cfg }, targetConnected: false }));
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
      selectedSourceConnectionId: s.selectedTargetConnectionId,
      selectedTargetConnectionId: s.selectedSourceConnectionId,
      compareResult: null,
      selectedTable: null,
      generatedSql: null,
      syncSelection: {},
      migrationExecuted: false,
      browseMode: false,
      browseSide: null,
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
    const s = get();
    if (!s.compareResult) return;
    set({
      generatedSql: regenerateSql(s, s.syncSelection, s.memberSelection, s.indexSelection),
      migrationExecuted: false,
    });
  },

  // Execution-mode only — doesn't change the generated SQL, so no regeneration needed.
  setContinueOnError: (continueOnError) => set({ continueOnError }),

  setFilterStatus: (filterStatus) => set({ filterStatus }),
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  toggleTypeFilter: (type) =>
    set((state) => {
      const active = state.typeFilter;
      const next = active.includes(type) ? active.filter((t) => t !== type) : [...active, type];
      return { typeFilter: next };
    }),
  clearTypeFilter: () => set({ typeFilter: [] }),
  setSelectedTable: (selectedTable) => set({ selectedTable }),

  toggleSyncSelection: (tableName) => {
    const s = get();
    if (!s.compareResult) return;
    const nextSelection = { ...s.syncSelection, [tableName]: !s.syncSelection[tableName] };
    set({
      syncSelection: nextSelection,
      generatedSql: regenerateSql(s, nextSelection, s.memberSelection, s.indexSelection),
      migrationExecuted: false,
    });
  },

  setAllSyncSelection: (selected) => {
    const s = get();
    if (!s.compareResult) return;
    const nextSelection: Record<string, boolean> = {};
    for (const t of s.compareResult.tables) {
      if (t.status !== 'UNCHANGED') nextSelection[t.tableName] = selected;
    }
    set({
      syncSelection: nextSelection,
      generatedSql: regenerateSql(s, nextSelection, s.memberSelection, s.indexSelection),
      migrationExecuted: false,
    });
  },

  toggleMemberSelection: (roleName, memberName) => {
    const s = get();
    if (!s.compareResult) return;
    const roleSel = { ...(s.memberSelection[roleName] ?? {}) };
    // Default included; toggle to false (excluded) and back.
    roleSel[memberName] = roleSel[memberName] === false ? true : false;
    const nextMember = { ...s.memberSelection, [roleName]: roleSel };
    set({
      memberSelection: nextMember,
      generatedSql: regenerateSql(s, s.syncSelection, nextMember, s.indexSelection),
      migrationExecuted: false,
    });
  },

  setAllMemberSelection: (roleName, selected) => {
    const s = get();
    if (!s.compareResult) return;
    const role = s.compareResult.tables.find((t) => t.tableName === roleName && t.objectType === 'ROLE');
    if (!role) return;
    const roleSel: Record<string, boolean> = {};
    for (const m of role.columnDiffs) {
      if (m.status !== 'UNCHANGED') roleSel[m.name] = selected;
    }
    const nextMember = { ...s.memberSelection, [roleName]: roleSel };
    set({
      memberSelection: nextMember,
      generatedSql: regenerateSql(s, s.syncSelection, nextMember, s.indexSelection),
      migrationExecuted: false,
    });
  },

  toggleIndexSelection: (tableName, indexName) => {
    const s = get();
    if (!s.compareResult) return;
    const tableSel = { ...(s.indexSelection[tableName] ?? {}) };
    // Default excluded; toggle to true (included) and back.
    tableSel[indexName] = tableSel[indexName] === true ? false : true;
    const nextIndex = { ...s.indexSelection, [tableName]: tableSel };
    set({
      indexSelection: nextIndex,
      generatedSql: regenerateSql(s, s.syncSelection, s.memberSelection, nextIndex),
      migrationExecuted: false,
    });
  },

  setAllIndexSelection: (tableName, selected) => {
    const s = get();
    if (!s.compareResult) return;
    const table = s.compareResult.tables.find((t) => t.tableName === tableName);
    if (!table) return;
    const tableSel: Record<string, boolean> = {};
    for (const i of table.indexDiffs) {
      if (i.status !== 'UNCHANGED') tableSel[i.name] = selected;
    }
    const nextIndex = { ...s.indexSelection, [tableName]: tableSel };
    set({
      indexSelection: nextIndex,
      generatedSql: regenerateSql(s, s.syncSelection, s.memberSelection, nextIndex),
      migrationExecuted: false,
    });
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
      set({ sourceConfig: { ...get().sourceConfig, schema }, compareResult: null, selectedTable: null, generatedSql: null, syncSelection: {}, browseMode: false, browseSide: null });
    } else {
      set({ targetConfig: { ...get().targetConfig, schema }, compareResult: null, selectedTable: null, generatedSql: null, syncSelection: {}, browseMode: false, browseSide: null });
    }
  },

  testSourceConnection: async () => {
    set({ isTestingSource: true, errorMsg: null });
    try {
      invalidateCache('schemas:');
      const { version } = await apiTestConnection(buildRef(get().sourceConfig));
      set({ sourceConnected: true, isTestingSource: false, sourceServerVersion: version });
      await get().loadSchemaList('source');
    } catch (e: any) {
      set({ errorMsg: e.message || 'Source connection failed', isTestingSource: false, sourceConnected: false, sourceServerVersion: undefined });
    }
  },

  testTargetConnection: async () => {
    set({ isTestingTarget: true, errorMsg: null });
    try {
      invalidateCache('schemas:');
      const { version } = await apiTestConnection(buildRef(get().targetConfig));
      set({ targetConnected: true, isTestingTarget: false, targetServerVersion: version });
      await get().loadSchemaList('target');
    } catch (e: any) {
      set({ errorMsg: e.message || 'Target connection failed', isTestingTarget: false, targetConnected: false, targetServerVersion: undefined });
    }
  },

  browseSchema: async (side) => {
    const cfg = side === 'source' ? get().sourceConfig : get().targetConfig;
    set({ isBrowsing: true, errorMsg: null, warnings: [], compareResult: null, selectedTable: null, generatedSql: null, migrationExecuted: false });
    try {
      // Refresh the schema list so we browse against current server state
      await get().loadSchemaList(side);
      const ref = buildRef(side === 'source' ? get().sourceConfig : get().targetConfig);
      const { tables, warnings } = await loadSchema(ref, get().selectedObjectTypes);
      const result = buildBrowseResult(tables, side);
      set({
        compareResult: result,
        warnings: warnings ?? [],
        browseMode: true,
        browseSide: side,
        syncSelection: {},
        selectedTable: result.tables[0] || null,
        isBrowsing: false,
      });
    } catch (e: any) {
      set({ errorMsg: e.message || `Failed to load ${side} schema`, isBrowsing: false });
    }
  },

  runSchemaComparison: async () => {
    set({ isComparing: true, errorMsg: null, warnings: [], compareResult: null, selectedTable: null, generatedSql: null, migrationExecuted: false, browseMode: false, browseSide: null });
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
      const sql = sqlGeneratorModule.generateMigrationSql([], targetConfig.dialect, buildMapping(get()));

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

  dismissWarnings: () => set({ warnings: [] }),

  clearMigrationProgress: () =>
    set({ migrationProgress: [], snapshotDdl: null, migrationError: null, migrationRolledBack: false }),

  skipObjectAndRetry: async (objectName) => {
    const s = get();
    // Deselect the failed object so the regenerated plan excludes it, then re-run.
    const nextSelection = { ...s.syncSelection, [objectName]: false };
    set({
      syncSelection: nextSelection,
      generatedSql: regenerateSql(s, nextSelection, s.memberSelection, s.indexSelection),
      migrationProgress: [],
      migrationError: null,
      migrationRolledBack: false,
      snapshotDdl: null,
      migrationExecuted: false,
    });
    await get().applyMigration();
  },

  applyMigration: async () => {
    const { compareResult, syncSelection, targetConfig, continueOnError } = get();
    if (!compareResult) return;

    const includedDiffs = compareResult.tables.filter((t) => syncSelection[t.tableName]);
    const plan = sqlGeneratorModule.generateMigrationPlan(includedDiffs, targetConfig.dialect, buildMapping(get()));
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
        },
        continueOnError
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
      browseMode: false,
      browseSide: null,
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