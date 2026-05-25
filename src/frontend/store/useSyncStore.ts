import { create } from 'zustand';
import { ConnectionModule } from '../../backend/modules/connection.module';
import { CompareModule } from '../../backend/modules/compare.module';
import { SqlGeneratorModule } from '../../backend/modules/sql-generator.module';
import { TableSchema, DbObjectType } from '../../backend/interfaces/schema-provider.interface';
import { SchemaCompareResult, TableDiff } from '../../backend/types/diff.types';

const connectionModule = new ConnectionModule();
const compareModule = new CompareModule();
const sqlGeneratorModule = new SqlGeneratorModule();

interface ConnectionConfig {
  dialect: 'postgres' | 'mysql' | 'db2';
  connectionString: string;
  schema: string;
}

interface SyncState {
  sourceConfig: ConnectionConfig;
  targetConfig: ConnectionConfig;
  
  isTestingSource: boolean;
  isTestingTarget: boolean;
  sourceConnected: boolean;
  targetConnected: boolean;
  errorMsg: string | null;

  // Selected Object Scope selection filters
  selectedObjectTypes: DbObjectType[];

  isComparing: boolean;
  compareResult: SchemaCompareResult | null;
  selectedTable: TableDiff | null;
  generatedSql: string | null;
  migrationExecuted: boolean;
  filterStatus: 'ALL' | 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  searchTerm: string;

  setSourceConfig: (cfg: Partial<ConnectionConfig>) => void;
  setTargetConfig: (cfg: Partial<ConnectionConfig>) => void;
  toggleObjectTypeFilter: (type: DbObjectType) => void;
  setFilterStatus: (status: 'ALL' | 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED') => void;
  setSearchTerm: (term: string) => void;
  setSelectedTable: (table: TableDiff | null) => void;

  testSourceConnection: () => Promise<void>;
  testTargetConnection: () => Promise<void>;
  runSchemaComparison: () => Promise<void>;
  applyMigration: () => Promise<void>;
  resetSync: () => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  sourceConfig: {
    dialect: 'postgres',
    connectionString: 'postgresql://postgres:secret@localhost:5432/production_source',
    schema: 'public',
  },
  targetConfig: {
    dialect: 'postgres',
    connectionString: 'postgresql://postgres:secret@localhost:5432/staging_target',
    schema: 'public',
  },
  isTestingSource: false,
  isTestingTarget: false,
  sourceConnected: false,
  targetConnected: false,
  errorMsg: null,

  // Default to comparing all elements
  selectedObjectTypes: ['TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE'],

  isComparing: false,
  compareResult: null,
  selectedTable: null,
  generatedSql: null,
  migrationExecuted: false,
  filterStatus: 'ALL',
  searchTerm: '',

  setSourceConfig: (cfg) =>
    set((state) => ({ sourceConfig: { ...state.sourceConfig, ...cfg }, sourceConnected: false })),
  setTargetConfig: (cfg) =>
    set((state) => ({ targetConfig: { ...state.targetConfig, ...cfg }, targetConnected: false })),
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

  testSourceConnection: async () => {
    set({ isTestingSource: true, errorMsg: null });
    try {
      const { dialect, connectionString } = get().sourceConfig;
      const success = await connectionModule.testConnection(dialect, connectionString);
      set({ sourceConnected: success, isTestingSource: false });
    } catch (e: any) {
      set({ errorMsg: e.message || 'Source connection failed', isTestingSource: false, sourceConnected: false });
    }
  },

  testTargetConnection: async () => {
    set({ isTestingTarget: true, errorMsg: null });
    try {
      const { dialect, connectionString } = get().targetConfig;
      const success = await connectionModule.testConnection(dialect, connectionString);
      set({ targetConnected: success, isTestingTarget: false });
    } catch (e: any) {
      set({ errorMsg: e.message || 'Target connection failed', isTestingTarget: false, targetConnected: false });
    }
  },

  runSchemaComparison: async () => {
    set({ isComparing: true, errorMsg: null, compareResult: null, selectedTable: null, generatedSql: null, migrationExecuted: false });
    try {
      const { sourceConfig, targetConfig, selectedObjectTypes } = get();
      
      const sourceProvider = connectionModule.getProvider(sourceConfig.dialect);
      const targetProvider = connectionModule.getProvider(targetConfig.dialect);

      let sourceSchemas = await sourceProvider.getTables(sourceConfig.connectionString, sourceConfig.schema);
      let targetSchemas = await targetProvider.getTables(targetConfig.connectionString, targetConfig.schema);

      // Filter extracted tables based on active user settings (Table, View, Function, Procedure)
      sourceSchemas = sourceSchemas.filter(s => selectedObjectTypes.includes(s.objectType));
      targetSchemas = targetSchemas.filter(t => selectedObjectTypes.includes(t.objectType));

      const diffResult = await compareModule.compare(sourceSchemas, targetSchemas);
      const sql = sqlGeneratorModule.generateMigrationSql(diffResult.tables, targetConfig.dialect);

      set({
        compareResult: diffResult,
        generatedSql: sql,
        selectedTable: diffResult.tables[0] || null,
        isComparing: false,
      });
    } catch (e: any) {
      set({ errorMsg: e.message || 'Schema comparison encountered an error', isComparing: false });
    }
  },

  applyMigration: async () => {
    set({ isComparing: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    set({ migrationExecuted: true, isComparing: false });
  },

  resetSync: () => {
    set({
      compareResult: null,
      selectedTable: null,
      generatedSql: null,
      migrationExecuted: false,
    });
  },
}));
