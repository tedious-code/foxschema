/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared add / edit / clone / delete wiring for Data Peek and SQL Editor
 * query-result grids. Safe mode shows WriteConfirmDialog before DML runs.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { useSyncStore } from '../../store/useSyncStore';
import { useAuthStore } from '../../store/authStore';
import {
  assessPeekEditability,
  buildPeekDelete,
  buildPeekInsert,
  buildPeekUpdate,
  draftToArray,
  draftToRowValues,
  originalRowForPeekEdit,
  peekRowToDraft,
  type PeekEditability,
  type PeekWritePlan,
} from '../../lib/rowDml';
import { executeSql } from '../../api/sqlApi';
import type { TableSchema } from '../../lib/types';
import { PeekRowEditor, type PeekRowEditorMode } from './PeekRowEditor';
import { WriteConfirmDialog } from './WriteConfirmDialog';
import { SQL_ICON_STROKE } from './sqlIconStyle';

export interface PeekGridCrudArgs {
  connectionId: string;
  dialect: string;
  tableName: string;
  table: TableSchema | undefined;
  columns: string[];
  rows: unknown[][];
  resultOk: boolean;
  /** Reset editor/selection when the grid identity changes (panel id, statement, …). */
  sessionKey: string;
  /** Soft reset selection when the result payload refreshes. */
  resultEpoch: unknown;
  onAfterWrite: () => void | Promise<void>;
  /** Build data-testid for crud / add / edit / clone / delete / write-error. */
  testId: (action: 'crud' | 'add' | 'edit' | 'clone' | 'delete' | 'write-error') => string;
}

export interface PeekGridCrud {
  selectedRowIndex: number | null;
  onSelectRow: ((rowIdx: number) => void) | undefined;
  editability: PeekEditability;
  gridWritable: boolean;
  showCrud: boolean;
  crudButtons: React.ReactNode;
  writeErrorBanner: React.ReactNode;
  overlays: React.ReactNode;
  /** True while the row form or write confirm is open (Escape ownership). */
  overlayOpen: boolean;
}

export function usePeekGridCrud(args: PeekGridCrudArgs): PeekGridCrud {
  const {
    connectionId,
    dialect,
    tableName,
    table,
    columns,
    rows,
    resultOk,
    sessionKey,
    resultEpoch,
    onAfterWrite,
    testId,
  } = args;

  const safeMode = useSqlEditorStore((s) => s.safeMode);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const connections = useSyncStore((s) => s.connections);
  const conn = connections.find((c) => c.id === connectionId);
  const canInsert = useAuthStore((s) => s.can('editor.datagrid.insert'));
  const canUpdate = useAuthStore((s) => s.can('editor.datagrid.update'));
  const canDelete = useAuthStore((s) => s.can('editor.datagrid.delete'));
  const canWriteSql = useAuthStore((s) => s.can('editor.dml'));

  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [editor, setEditor] = useState<{
    mode: PeekRowEditorMode;
    draft: Record<string, string>;
    rowIndex: number | null;
    originalRow?: unknown[];
  } | null>(null);
  const [pendingWrite, setPendingWrite] = useState<PeekWritePlan | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (!editor && !pendingWrite) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (pendingWrite) {
        setPendingWrite(null);
        return;
      }
      setEditor(null);
      setWriteError(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, pendingWrite]);

  useEffect(() => {
    setSelectedRowIndex(null);
    setEditor(null);
    setPendingWrite(null);
    setWriteError(null);
  }, [sessionKey]);

  useEffect(() => {
    if (editor || pendingWrite) return;
    setSelectedRowIndex(null);
  }, [resultEpoch, editor, pendingWrite]);

  const editability = useMemo(
    () => assessPeekEditability({ dialect, table, resultColumns: columns }),
    [dialect, table, columns]
  );

  const selectedRow =
    resultOk && selectedRowIndex != null ? rows[selectedRowIndex] : undefined;

  const gridWritable = editability.editable && canWriteSql;
  const canAnyRowAction = canInsert || canUpdate || canDelete;
  const showCrud = gridWritable && resultOk && !!table && canAnyRowAction;
  const canMutateRow = gridWritable && selectedRowIndex != null && Boolean(selectedRow);

  const runWrite = useCallback(
    async (plan: PeekWritePlan) => {
      if (writing) return;
      setWriting(true);
      setWriteError(null);
      setPendingWrite(null);
      try {
        const { results } = await executeSql(
          {
            connectionId,
            password: sessionPasswords[connectionId] || undefined,
            schema: conn?.schema?.trim() || undefined,
          },
          [plan.sql],
          undefined,
          undefined,
          plan.params.length ? [plan.params] : undefined,
          { datagridAction: plan.kind }
        );
        const failed = results.find((r) => !r.ok);
        if (failed && !failed.ok) {
          setWriteError(failed.error || 'Write failed');
          return;
        }
        setEditor(null);
        setSelectedRowIndex(null);
        await onAfterWrite();
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e));
      } finally {
        setWriting(false);
      }
    },
    [writing, connectionId, sessionPasswords, conn?.schema, onAfterWrite]
  );

  const queueOrRun = useCallback(
    (plan: PeekWritePlan) => {
      setWriteError(null);
      if (safeMode) {
        // Keep the row form mounted under WriteConfirmDialog (Data Peek behaviour):
        // cancel returns to the draft; only a successful write clears the editor.
        setPendingWrite(plan);
        return;
      }
      void runWrite(plan);
    },
    [safeMode, runWrite]
  );

  const openAdd = () => {
    if (!gridWritable || !canInsert || !table || !resultOk) return;
    setEditor({
      mode: 'add',
      draft: peekRowToDraft(columns, null, {
        clearIdentity: editability.identityColumns,
      }),
      rowIndex: null,
    });
  };

  const openEdit = () => {
    if (!gridWritable || !canUpdate || !table || !resultOk || selectedRowIndex == null) return;
    const row = rows[selectedRowIndex];
    if (!row) return;
    setEditor({
      mode: 'edit',
      draft: peekRowToDraft(columns, row),
      rowIndex: selectedRowIndex,
      originalRow: row.slice(),
    });
  };

  const openClone = () => {
    if (!gridWritable || !canInsert || !table || !resultOk || selectedRowIndex == null) return;
    const row = rows[selectedRowIndex];
    if (!row) return;
    setEditor({
      mode: 'clone',
      draft: peekRowToDraft(columns, row, {
        clearKeys: editability.keyColumns.map((k) => k.name),
        clearIdentity: editability.identityColumns,
      }),
      rowIndex: selectedRowIndex,
    });
  };

  const openDelete = () => {
    if (!gridWritable || !canDelete || !resultOk || selectedRowIndex == null) return;
    const row = rows[selectedRowIndex];
    if (!row) return;
    const plan = buildPeekDelete({
      tableName,
      dialect,
      columns,
      row,
      keyColumns: editability.keyColumns,
    });
    if ('error' in plan) {
      setWriteError(plan.error);
      return;
    }
    queueOrRun(plan);
  };

  const onEditorSubmit = (draft: Record<string, string>) => {
    if (!gridWritable || !resultOk || !editor) return;
    if (editor.mode === 'edit') {
      const original = originalRowForPeekEdit(editor, rows);
      if (!original) return;
      const plan = buildPeekUpdate({
        tableName,
        dialect,
        columns,
        originalRow: original,
        draftRow: draftToArray(columns, draft, original),
        keyColumns: editability.keyColumns,
      });
      if ('error' in plan) {
        setWriteError(plan.error);
        return;
      }
      queueOrRun(plan);
      return;
    }
    const plan = buildPeekInsert({
      tableName,
      dialect,
      values: draftToRowValues(columns, draft),
      identityColumns: editability.identityColumns,
    });
    if ('error' in plan) {
      setWriteError(plan.error);
      return;
    }
    queueOrRun(plan);
  };

  const btn =
    'p-1 rounded text-slate-400 hover:bg-slate-800 disabled:opacity-40';

  const crudButtons = showCrud ? (
    <div className="flex items-center gap-0.5 shrink-0" data-testid={testId('crud')}>
      {canInsert && (
        <button
          type="button"
          data-testid={testId('add')}
          title="Add row"
          aria-label="Add row"
          disabled={writing}
          onClick={openAdd}
          className={`${btn} hover:text-emerald-300`}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
        </button>
      )}
      {canUpdate && (
        <button
          type="button"
          data-testid={testId('edit')}
          title="Edit selected row"
          aria-label="Edit selected row"
          disabled={!canMutateRow || writing}
          onClick={openEdit}
          className={`${btn} hover:text-cyan-300`}
        >
          <Pencil className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
        </button>
      )}
      {canInsert && (
        <button
          type="button"
          data-testid={testId('clone')}
          title="Clone selected row"
          aria-label="Clone selected row"
          disabled={!canMutateRow || writing}
          onClick={openClone}
          className={`${btn} hover:text-amber-300`}
        >
          <Copy className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          data-testid={testId('delete')}
          title="Delete selected row"
          aria-label="Delete selected row"
          disabled={!canMutateRow || writing}
          onClick={openDelete}
          className={`${btn} hover:text-rose-300`}
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
        </button>
      )}
    </div>
  ) : null;

  const writeErrorBanner = writeError ? (
    <div
      data-testid={testId('write-error')}
      className="mx-0.5 mb-1 rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-sm font-semibold text-rose-300"
    >
      {writeError}
    </div>
  ) : null;

  const overlays = (
    <>
      {editor && table && resultOk && (
        <PeekRowEditor
          open
          mode={editor.mode}
          tableName={tableName}
          table={table}
          columns={columns}
          draft={editor.draft}
          keyNames={editability.keyColumns.map((k) => k.name)}
          identityColumns={editability.identityColumns}
          onCancel={() => {
            setEditor(null);
            setWriteError(null);
          }}
          onSubmit={onEditorSubmit}
        />
      )}
      {pendingWrite && (
        <WriteConfirmDialog
          writeStatements={[pendingWrite.displaySql]}
          credentialCount={1}
          readonlyTargets={
            dialect.toLowerCase() === 'clickhouse'
              ? [{ name: conn?.name || connectionId, dialect }]
              : []
          }
          onCancel={() => setPendingWrite(null)}
          onConfirm={() => void runWrite(pendingWrite)}
        />
      )}
    </>
  );

  return {
    selectedRowIndex,
    onSelectRow: gridWritable && canAnyRowAction ? setSelectedRowIndex : undefined,
    editability,
    gridWritable,
    showCrud,
    crudButtons,
    writeErrorBanner,
    overlays,
    overlayOpen: Boolean(editor || pendingWrite),
  };
}
