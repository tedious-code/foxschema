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
export { SqlDiffEditor } from './components/SqlEditor';
export { SqlEditor } from './components/SqlEditor';
export { SqlEditorView } from './components/SqlEditorView';
