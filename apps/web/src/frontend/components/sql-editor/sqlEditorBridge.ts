import type { TableSchema } from '../../lib/types';
import type { SqlVariable } from '../../lib/sql-variables';

/** One connection's cached tables for autocomplete / explorer. */
export interface SchemaCacheEntry {
  status: 'idle' | 'loading' | 'ready' | 'error';
  tables?: TableSchema[];
  error?: string;
}

export interface CompletionSchemaSource {
  connectionId: string;
  tables: TableSchema[];
}

export interface CompletionContext {
  sql: string;
  /** Schemas for checked credentials that have been loaded. */
  schemas: CompletionSchemaSource[];
  /** Global SQL Editor variables for `${{` autocomplete. */
  variables: SqlVariable[];
}

type ContextGetter = () => CompletionContext;
type InsertHandler = (text: string) => void;

let contextGetter: ContextGetter = () => ({ sql: '', schemas: [], variables: [] });
let insertHandler: InsertHandler | null = null;

/** Wired once from SqlEditorView so the completion provider stays leak-free. */
export function setCompletionContextGetter(fn: ContextGetter): void {
  contextGetter = fn;
}

export function getCompletionContext(): CompletionContext {
  return contextGetter();
}

/** Wired from SqlEditorPane onMount / disposed on unmount. */
export function setSqlInsertHandler(fn: InsertHandler | null): void {
  insertHandler = fn;
}

export function insertAtCursor(text: string): void {
  insertHandler?.(text);
}

type SelectionGetter = () => string | null;
let selectionGetter: SelectionGetter = () => null;

/** Wired from SqlEditorPane — non-empty Monaco selection text, else null. */
export function setSqlSelectionGetter(fn: SelectionGetter | null): void {
  selectionGetter = fn ?? (() => null);
}

/** Current editor selection used by Run (selection overrides statement strip). */
export function getSelectedSql(): string | null {
  return selectionGetter();
}
