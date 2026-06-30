// Single source of truth for engine types: re-exported from the browser-safe
// core entry. The Vite alias maps '@foxschema/core' to packages/core/src/browser.ts
// (no Node built-ins), so the frontend bundle stays clean — no need to maintain a
// hand-kept duplicate here.
export type {
  DbObjectType,
  DiffType,
  RoutineParameterMode,
  RoutineParameter,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  PrimaryKeyInfo,
  TriggerInfo,
  SequenceInfo,
  UserTypeInfo,
  TableSchema,
  ColumnDiff,
  IndexDiff,
  ForeignKeyDiff,
  TriggerDiff,
  TableDiff,
  SchemaCompareResult,
  MigrationStep,
  MigrationEvent,
  DriverInfo,
  SavedConnection,
} from '@foxschema/core';
