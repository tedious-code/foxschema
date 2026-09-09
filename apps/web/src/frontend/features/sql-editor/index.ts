/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The sql-editor feature's public surface.
 *
 * Everything else under this folder is internal, so the layout can change
 * without touching a consumer. These are the symbols other parts of the app
 * actually import today — derived from usage, not guessed, so the surface
 * starts as small as it truly is.
 */
export { SchemaTreePanel, TYPE_META, TYPE_ORDER } from './components/SchemaTreePanel';
export { WriteConfirmDialog } from './components/WriteConfirmDialog';
export { scrubRemovedFileConnections } from './lib/fileQueryEditorHelpers';
export { getCaretOffset, getSelectedSql, insertAtCursor } from './lib/sqlEditorBridge';
export type { SchemaCacheEntry } from './lib/sqlEditorBridge';
export { dialectFkConstraintSupport, dialectIndexSupport, executableSqlStatements, findInboundForeignKeyTables, generateCloneTableSql } from './lib/tableBlueprintSql';
// The editor views are deliberately NOT re-exported here.
//
// A barrel is one module: re-exporting them made every consumer of any symbol
// above pull Monaco (2.6 MB) into the eager graph, which is what turned the
// `lazy()` calls in App.tsx and elsewhere into decoration. Rolldown had been
// saying so all along — INEFFECTIVE_DYNAMIC_IMPORT.
//
// Every consumer of these loads them through `lazy(() => import(...))`, so
// importing the component module directly costs them nothing and keeps the
// editor out of first paint.
