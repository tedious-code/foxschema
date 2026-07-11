import type { ConnectionOptions, DbObjectType, TableDiff } from '@foxschema/core';

/** A resolved, ready-to-use connection — the TUI's equivalent of connectionRef.ts's ResolvedRef, plus a display label. */
export interface ConnRef {
  dialect: string;
  option: ConnectionOptions;
  schema: string;
  label: string;
}

/** Tri-state async result every data hook returns; every screen renders one of the three branches. */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T };

export type Role = 'source' | 'target';

/** Why the user is picking connections — decides what screen they land on once both are picked. */
export type Purpose = 'compare' | 'migrate';

/**
 * Stack-based screen state. App.tsx keeps Screen[] (not just a "current" screen), so
 * `esc` always means "go back one level" without a screen needing to know its predecessor.
 */
export type Screen =
  | { name: 'mainMenu' }
  | { name: 'setupRequired' }
  | { name: 'connectionPicker'; role: Role; purpose: Purpose; source?: ConnRef }
  | { name: 'connectionForm'; role: Role; purpose: Purpose; source?: ConnRef }
  | { name: 'connectionManage' }
  | { name: 'compare'; source: ConnRef; target: ConnRef; scope?: DbObjectType[] }
  | { name: 'tableDiffDetail'; source: ConnRef; target: ConnRef; diff: TableDiff }
  | { name: 'migrateConfirm'; source: ConnRef; target: ConnRef }
  | { name: 'migrateProgress'; source: ConnRef; target: ConnRef; continueOnError: boolean }
  | { name: 'historyList' }
  | { name: 'historyDetail'; runId: string };

export type Action = { type: 'PUSH'; screen: Screen } | { type: 'POP' } | { type: 'RESET'; screen: Screen };
