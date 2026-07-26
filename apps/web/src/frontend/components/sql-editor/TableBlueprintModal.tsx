import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { ColumnInfo, TableSchema } from '../../lib/types';
import { executeSql } from '../../api/sqlApi';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { insertAtCursor } from './sqlEditorBridge';
import { WriteConfirmDialog } from './WriteConfirmDialog';
import {
  applyTypeSize,
  classifyColumnType,
  columnTypeKindClasses,
  defaultDialectColumnType,
  dialectBooleanDefaultOptions,
  dialectColumnConstraints,
  dialectIdentitySupport,
  diffBlueprintColumns,
  generateCreateTableSql,
  generateDropTableSql,
  generateTableBlueprintSql,
  isBooleanBitType,
  isIntegerAutoIncrementType,
  listDialectDataTypes,
  parseTypeSize,
  pkColumnsFromTable,
  sameStringList,
  withAutoIncrement,
} from './tableBlueprintSql';
import { SQL_ICON_STROKE } from './sqlIconStyle';
import { TYPE_META } from '../SchemaTreePanel';

export type BlueprintMode = 'edit' | 'create';

interface Props {
  connectionId: string;
  dialect: string;
  onClose: () => void;
  /** Existing table to edit; omit / null for create-new mode. */
  table: TableSchema | null;
  mode?: BlueprintMode;
}

type BlueprintColumn = ColumnInfo & { unique?: boolean };

function emptyColumn(dialect: string): BlueprintColumn {
  return {
    name: '',
    type: defaultDialectColumnType(dialect),
    nullable: true,
    primaryKey: false,
    unique: false,
  };
}

function cloneColumns(cols: ColumnInfo[]): BlueprintColumn[] {
  return cols.map((c) => ({ ...c, unique: false }));
}

/**
 * One-viewport vertical blueprint: columns (with dialect identity), composite PK,
 * FKs/triggers (edit), create / drop table with existence-safe SQL.
 */
export const TableBlueprintModal: React.FC<Props> = ({
  connectionId,
  table,
  dialect,
  onClose,
  mode: modeProp,
}) => {
  const mode: BlueprintMode = modeProp ?? (table ? 'edit' : 'create');
  const ensureSchema = useSqlEditorStore((s) => s.ensureSchema);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const safeMode = useSqlEditorStore((s) => s.safeMode);
  const cachedTables = useSqlEditorStore((s) => s.schemaCache[connectionId]?.tables);

  const liveTable =
    mode === 'edit' && table
      ? (cachedTables?.find(
          (t) => t.name === table.name && t.objectType === table.objectType
        ) ?? table)
      : null;

  const [createName, setCreateName] = useState('');
  const [original, setOriginal] = useState<BlueprintColumn[]>([]);
  const [draft, setDraft] = useState<BlueprintColumn[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [originalPk, setOriginalPk] = useState<string[]>([]);
  const [draftPk, setDraftPk] = useState<string[]>([]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BlueprintColumn | null>(null);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<BlueprintColumn>(() => emptyColumn(dialect));
  const [expandedTrig, setExpandedTrig] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'create') {
      setCreateName('');
      setOriginal([]);
      setDraft([]);
      setDropped(new Set());
      setOriginalPk([]);
      setDraftPk([]);
      setEditingName(null);
      setEditForm(null);
      setAdding(false);
      setError(null);
      return;
    }
    if (!liveTable) return;
    const cols = cloneColumns(liveTable.columns ?? []);
    const pk = pkColumnsFromTable(liveTable);
    setOriginal(cols);
    setDraft(cols);
    setDropped(new Set());
    setOriginalPk(pk);
    setDraftPk(pk);
    setEditingName(null);
    setEditForm(null);
    setAdding(false);
    setError(null);
  }, [mode, liveTable]);

  const tableName = mode === 'create' ? createName.trim() : (liveTable?.name ?? '');
  const activeColumns = draft.filter((c) => !dropped.has(c.name));

  const columnOps = useMemo(
    () => (mode === 'create' ? [] : diffBlueprintColumns(original, draft, dropped)),
    [mode, original, draft, dropped]
  );

  const statements = useMemo(() => {
    if (mode === 'create') {
      return generateCreateTableSql(tableName, activeColumns, draftPk, dialect);
    }
    return generateTableBlueprintSql({
      tableName,
      dialect,
      columnOps,
      previousPk: originalPk,
      nextPk: draftPk.filter((n) => activeColumns.some((c) => c.name === n)),
      pkName: liveTable?.primaryKey?.name,
    });
  }, [
    mode,
    tableName,
    activeColumns,
    draftPk,
    dialect,
    columnOps,
    originalPk,
    liveTable?.primaryKey?.name,
  ]);

  const dropStatements = useMemo(
    () => (mode === 'edit' && tableName ? generateDropTableSql(tableName, dialect) : []),
    [mode, tableName, dialect]
  );

  const sqlText = statements.join('\n');
  const hasOps =
    mode === 'create'
      ? statements.length > 0 && !!tableName && activeColumns.length > 0
      : statements.length > 0;
  const pkDirty = mode === 'edit' && !sameStringList(originalPk, draftPk);

  const meta = TYPE_META.TABLE;
  const fks = liveTable?.foreignKeys ?? [];
  const triggers = liveTable?.triggers ?? [];
  const identityUi = dialectIdentitySupport(dialect);

  const syncPkFlags = (pk: string[]) => {
    setDraftPk(pk);
    setDraft((rows) =>
      rows.map((c) => ({
        ...c,
        primaryKey: pk.includes(c.name),
        // PK columns must be NOT NULL
        nullable: pk.includes(c.name) ? false : c.nullable,
      }))
    );
  };

  const toggleAutoIncrement = (name: string) => {
    setDraft((rows) =>
      rows.map((c) => {
        if (c.name !== name) return c;
        if (!isIntegerAutoIncrementType(c.type)) return c;
        return withAutoIncrement(c, !c.identity);
      })
    );
  };

  const togglePkColumn = (name: string) => {
    if (dropped.has(name)) return;
    if (draftPk.includes(name)) {
      syncPkFlags(draftPk.filter((n) => n !== name));
    } else {
      syncPkFlags([...draftPk, name]);
    }
  };

  const movePk = (name: string, dir: -1 | 1) => {
    const i = draftPk.indexOf(name);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= draftPk.length) return;
    const next = [...draftPk];
    [next[i], next[j]] = [next[j]!, next[i]!];
    syncPkFlags(next);
  };

  const startEdit = (col: BlueprintColumn) => {
    if (dropped.has(col.name)) return;
    setEditingName(col.name);
    setEditForm({ ...col });
    setAdding(false);
  };

  const saveEdit = () => {
    if (!editForm || !editingName) return;
    const name = editForm.name.trim();
    if (!name) {
      setError('Column name is required');
      return;
    }
    setDraft((rows) =>
      rows.map((c) => (c.name === editingName ? { ...editForm, name } : c))
    );
    if (editingName !== name) {
      setDraftPk((pk) => pk.map((n) => (n === editingName ? name : n)));
    }
    setEditingName(null);
    setEditForm(null);
    setError(null);
  };

  const markDrop = (name: string) => {
    const isNew = mode === 'create' || !original.some((c) => c.name === name);
    if (isNew) {
      setDraft((rows) => rows.filter((c) => c.name !== name));
      setDraftPk((pk) => pk.filter((n) => n !== name));
      return;
    }
    setDropped((prev) => new Set(prev).add(name));
    setDraftPk((pk) => pk.filter((n) => n !== name));
    if (editingName === name) {
      setEditingName(null);
      setEditForm(null);
    }
  };

  const undoDrop = (name: string) => {
    setDropped((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const saveAdd = () => {
    const name = addForm.name.trim();
    if (!name) {
      setError('Column name is required');
      return;
    }
    if (draft.some((c) => c.name === name)) {
      setError(`Column "${name}" already exists`);
      return;
    }
    const col = {
      ...addForm,
      name,
      primaryKey: false,
      nullable: addForm.identity ? false : addForm.nullable,
    };
    setDraft((rows) => [...rows, col]);
    setAddForm(emptyColumn(dialect));
    setAdding(false);
    setError(null);
  };

  const insertSql = (stmts: string[] = statements) => {
    if (stmts.length === 0) return;
    const text = stmts.join('\n');
    insertAtCursor(text.endsWith('\n') ? text : `${text}\n`);
    setToast('SQL inserted at cursor');
    setTimeout(() => setToast(null), 2000);
  };

  const runApply = async (stmts: string[] = statements, closeOnSuccess = mode === 'create') => {
    if (stmts.length === 0 || applying) return;
    setApplying(true);
    setError(null);
    setConfirmWrite(false);
    setConfirmDrop(false);
    try {
      const { results } = await executeSql(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        stmts
      );
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) {
        setError(failed.error);
        return;
      }
      await ensureSchema(connectionId, { force: true });
      setToast('Applied — schema refreshed');
      setTimeout(() => setToast(null), 2500);
      if (closeOnSuccess) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const onApplyClick = () => {
    if (!hasOps) return;
    if (safeMode) {
      setConfirmWrite(true);
      return;
    }
    void runApply();
  };

  const onDropTableClick = () => {
    if (dropStatements.length === 0) return;
    setConfirmDrop(true);
  };

  return createPortal(
    <>
      <div
        data-testid="table-blueprint-modal"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/50 flex items-center gap-2.5 shrink-0">
            <span className="shrink-0">{meta.icon}</span>
            <div className="min-w-0 flex-1">
              {mode === 'create' ? (
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="new_table_name"
                  data-testid="blueprint-table-name"
                  className="w-full bg-transparent border-b border-slate-700 focus:border-cyan-500 outline-none text-slate-100 font-bold text-base font-mono py-0.5"
                />
              ) : (
                <h2 className="text-slate-100 font-bold text-base font-mono truncate">
                  {liveTable?.name}
                </h2>
              )}
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">
                {mode === 'create' ? 'Create table' : 'Table blueprint'} · {dialect}
              </p>
            </div>
            {toast && (
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 shrink-0">
                <Check className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} /> {toast}
              </span>
            )}
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" strokeWidth={SQL_ICON_STROKE} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
            {/* Columns */}
            <section>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Columns3 className="w-3.5 h-3.5 text-cyan-400" strokeWidth={SQL_ICON_STROKE} />
                  Columns
                  <span className="text-slate-600 font-mono normal-case">({draft.length})</span>
                </h3>
                {!adding && (
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(true);
                      setEditingName(null);
                      setAddForm(emptyColumn(dialect));
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded border border-emerald-500/30 bg-emerald-950/30"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} /> Add column
                  </button>
                )}
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden divide-y divide-slate-800/80">
                {draft.map((col) => {
                  const isDropped = dropped.has(col.name);
                  const isEditing = editingName === col.name;
                  const isNew = mode === 'create' || !original.some((c) => c.name === col.name);
                  const inPk = draftPk.includes(col.name);
                  const kind = classifyColumnType(col.type);
                  const kindUi = columnTypeKindClasses(kind);
                  const showAutoInc = isIntegerAutoIncrementType(col.type);
                  return (
                    <div
                      key={col.name}
                      className={`px-3 py-2 border-l-4 ${kindUi.bar} ${
                        isDropped ? 'opacity-50 bg-rose-950/20' : ''
                      } ${isNew ? 'bg-emerald-950/10' : ''}`}
                    >
                      {isEditing && editForm ? (
                        <ColumnForm
                          value={editForm}
                          onChange={setEditForm}
                          onSave={saveEdit}
                          onCancel={() => {
                            setEditingName(null);
                            setEditForm(null);
                          }}
                          nameLocked={!isNew && mode === 'edit'}
                          dialect={dialect}
                        />
                      ) : (
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span
                            className={`font-mono font-semibold text-[13px] truncate ${
                              isDropped ? 'line-through text-rose-300' : 'text-slate-200'
                            }`}
                          >
                            {col.name}
                          </span>
                          {inPk && (
                            <KeyRound
                              className="w-3.5 h-3.5 text-amber-400 shrink-0"
                              aria-label="Primary key"
                            />
                          )}
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${kindUi.badge}`}
                          >
                            {kindUi.label}
                          </span>
                          <span className="text-[12px] font-mono truncate text-slate-400">
                            {col.type}
                            {col.identity && showAutoInc
                              ? resolveDialectIdentityPreview(col, dialect)
                              : ''}
                            {!col.nullable ? ' NOT NULL' : ''}
                            {col.unique ? ' UNIQUE' : ''}
                            {col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ''}
                          </span>
                          {!isDropped && showAutoInc && (
                            <label
                              className="flex items-center gap-1.5 shrink-0 text-[11px] font-semibold text-violet-200 cursor-pointer ml-1 px-1.5 py-0.5 rounded border border-violet-500/35 bg-violet-950/40"
                              title={`Auto increment → ${identityUi.clauseHint}`}
                            >
                              <input
                                type="checkbox"
                                checked={!!col.identity}
                                onChange={() => toggleAutoIncrement(col.name)}
                                className="w-3.5 h-3.5 accent-violet-500"
                                data-testid={`blueprint-ai-${col.name}`}
                              />
                              Auto inc
                            </label>
                          )}
                          <div className="ml-auto flex items-center gap-0.5 shrink-0">
                            {isDropped ? (
                              <button
                                type="button"
                                title="Undo drop"
                                onClick={() => undoDrop(col.name)}
                                className="px-2 py-1 text-[10px] font-bold text-slate-300 hover:text-white"
                              >
                                Undo
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  title="Edit column"
                                  onClick={() => startEdit(col)}
                                  className="p-1.5 rounded text-slate-500 hover:text-sky-300 hover:bg-slate-800"
                                >
                                  <Pencil className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
                                </button>
                                <button
                                  type="button"
                                  title="Drop column"
                                  onClick={() => markDrop(col.name)}
                                  className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                                >
                                  <Trash2 className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {draft.length === 0 && (
                  <p className="px-3 py-4 text-[12px] text-slate-500">No columns</p>
                )}
                {adding && (
                  <div className="px-3 py-2 bg-emerald-950/20">
                    <ColumnForm
                      value={addForm}
                      onChange={setAddForm}
                      onSave={saveAdd}
                      onCancel={() => setAdding(false)}
                      nameLocked={false}
                      dialect={dialect}
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Primary key (composite) */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-amber-400" strokeWidth={SQL_ICON_STROKE} />
                Primary key
                {pkDirty && (
                  <span className="text-[10px] font-bold text-amber-400 normal-case">changed</span>
                )}
              </h3>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 space-y-2">
                <p className="text-[11px] text-slate-500">
                  Check columns to build a single or composite key. Order matters — use arrows to
                  reorder.
                </p>
                {activeColumns.length === 0 ? (
                  <p className="text-[12px] text-slate-500">Add columns first</p>
                ) : (
                  <ul className="space-y-1">
                    {activeColumns.map((col) => {
                      const on = draftPk.includes(col.name);
                      const pkIndex = draftPk.indexOf(col.name);
                      return (
                        <li
                          key={col.name}
                          className="flex items-center gap-2 text-[12.5px] font-mono"
                        >
                          <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => togglePkColumn(col.name)}
                              className="w-3.5 h-3.5 accent-amber-500"
                            />
                            <span className="text-slate-200 truncate">{col.name}</span>
                            <span className="text-slate-500 truncate">{col.type}</span>
                          </label>
                          {on && (
                            <span className="flex items-center gap-0.5 shrink-0">
                              <span className="text-[10px] text-amber-400/80 font-bold w-4 text-center">
                                {pkIndex + 1}
                              </span>
                              <button
                                type="button"
                                title="Move up in key"
                                disabled={pkIndex <= 0}
                                onClick={() => movePk(col.name, -1)}
                                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
                              >
                                <ArrowUp className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
                              </button>
                              <button
                                type="button"
                                title="Move down in key"
                                disabled={pkIndex >= draftPk.length - 1}
                                onClick={() => movePk(col.name, 1)}
                                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
                              >
                                <ArrowDown className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
                              </button>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {draftPk.length > 0 && (
                  <p className="text-[12px] font-mono text-amber-200/90 pt-1 border-t border-slate-800">
                    PRIMARY KEY ({draftPk.join(', ')})
                  </p>
                )}
              </div>
            </section>

            {/* FK / triggers — edit mode only */}
            {mode === 'edit' && (
              <>
                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                    Foreign keys
                    <span className="text-slate-600 font-mono normal-case">({fks.length})</span>
                  </h3>
                  <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                    {fks.length === 0 ? (
                      <p className="px-3 py-3 text-[12px] text-slate-500">No foreign keys</p>
                    ) : (
                      <ul className="divide-y divide-slate-800/80">
                        {fks.map((fk) => (
                          <li key={fk.name} className="px-3 py-2.5 text-[12.5px]">
                            <span className="font-mono font-semibold text-slate-200">{fk.name}</span>
                            <span className="text-slate-500 mx-1.5">·</span>
                            <span className="font-mono text-slate-400">
                              ({fk.columns.join(', ')}) → {fk.referencedTable}(
                              {fk.referencedColumns.join(', ')})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                    Triggers
                    <span className="text-slate-600 font-mono normal-case">({triggers.length})</span>
                  </h3>
                  <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                    {triggers.length === 0 ? (
                      <p className="px-3 py-3 text-[12px] text-slate-500">No triggers</p>
                    ) : (
                      <ul className="divide-y divide-slate-800/80">
                        {triggers.map((trg) => {
                          const open = !!expandedTrig[trg.name];
                          return (
                            <li key={trg.name}>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedTrig((m) => ({ ...m, [trg.name]: !open }))
                                }
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-900/40"
                              >
                                {open ? (
                                  <ChevronDown
                                    className="w-3.5 h-3.5 text-slate-500 shrink-0"
                                    strokeWidth={SQL_ICON_STROKE}
                                  />
                                ) : (
                                  <ChevronRight
                                    className="w-3.5 h-3.5 text-slate-500 shrink-0"
                                    strokeWidth={SQL_ICON_STROKE}
                                  />
                                )}
                                <span className="font-mono font-semibold text-[12.5px] text-slate-200 truncate">
                                  {trg.name}
                                </span>
                                <span className="text-[11px] text-slate-500 ml-auto shrink-0">
                                  {[trg.timing, trg.event].filter(Boolean).join(' ') || '—'}
                                </span>
                              </button>
                              {open && (
                                <pre className="px-3 pb-3 text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                  {trg.definition?.trim() || '(no definition)'}
                                </pre>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </section>
              </>
            )}

            {identityUi.hint && (
              <p className="text-[11px] text-slate-500">{identityUi.hint}</p>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-800 bg-slate-950/70 px-5 py-3 space-y-2.5">
            {error && (
              <p
                className="text-[12px] text-rose-400 font-medium break-words"
                data-testid="blueprint-error"
              >
                {error}
              </p>
            )}
            <div className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 max-h-28 overflow-y-auto">
              {hasOps ? (
                <pre className="text-[11px] font-mono text-cyan-200/90 whitespace-pre-wrap break-words">
                  {sqlText}
                </pre>
              ) : (
                <p className="text-[11px] text-slate-600">
                  {mode === 'create'
                    ? 'Enter a table name and at least one column'
                    : 'No pending changes'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={onDropTableClick}
                  data-testid="blueprint-drop-table"
                  className="px-3 py-1.5 text-[12px] font-bold rounded-md border border-rose-500/40 text-rose-300 bg-rose-950/40 hover:bg-rose-950/70 mr-auto"
                >
                  Drop table
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-[12px] font-semibold text-slate-400 hover:text-slate-200 rounded-md ml-auto"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!hasOps}
                onClick={() => insertSql()}
                data-testid="blueprint-insert-sql"
                className="px-3 py-1.5 text-[12px] font-bold rounded-md border border-sky-500/35 text-sky-300 bg-sky-950/40 hover:bg-sky-950/70 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Insert SQL
              </button>
              <button
                type="button"
                disabled={!hasOps || applying}
                onClick={onApplyClick}
                data-testid="blueprint-apply"
                className="px-3 py-1.5 text-[12px] font-bold rounded-md border border-emerald-500/40 text-emerald-300 bg-emerald-950/50 hover:bg-emerald-950/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {applying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} />
                ) : (
                  <Play className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
                )}
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmWrite && (
        <WriteConfirmDialog
          writeStatements={statements}
          credentialCount={1}
          onCancel={() => setConfirmWrite(false)}
          onConfirm={() => void runApply()}
        />
      )}
      {confirmDrop && (
        <WriteConfirmDialog
          writeStatements={dropStatements}
          credentialCount={1}
          onCancel={() => setConfirmDrop(false)}
          onConfirm={() => void runApply(dropStatements, true)}
        />
      )}
    </>,
    document.body
  );
};

function resolveDialectIdentityPreview(col: ColumnInfo, dialect: string): string {
  if (!col.identity || !isIntegerAutoIncrementType(col.type)) return '';
  const d = dialect.toLowerCase();
  if (d === 'mysql' || d === 'mariadb' || d === 'tidb') return ' AUTO_INCREMENT';
  if (d === 'sqlserver' || d === 'azuresql') return ' IDENTITY(1,1)';
  if (d === 'redshift') return ' IDENTITY(0,1)';
  if (d === 'sqlite') return ' AUTOINCREMENT';
  const gen = col.identityGeneration ?? 'ALWAYS';
  return ` GENERATED ${gen} AS IDENTITY`;
}

const CUSTOM_TYPE = '__custom__';

const ColumnForm: React.FC<{
  value: BlueprintColumn;
  onChange: (c: BlueprintColumn) => void;
  onSave: () => void;
  onCancel: () => void;
  nameLocked: boolean;
  dialect: string;
}> = ({ value, onChange, onSave, onCancel, nameLocked, dialect }) => {
  const identityUi = dialectIdentitySupport(dialect);
  const constraints = dialectColumnConstraints(dialect);
  const typeOptions = useMemo(() => listDialectDataTypes(dialect), [dialect]);
  const [forceCustom, setForceCustom] = useState(false);
  const matched = typeOptions.find(
    (t) => t.value.toLowerCase() === value.type.trim().toLowerCase()
  );
  const selectValue = forceCustom || !matched ? CUSTOM_TYPE : matched.value;
  const kind = classifyColumnType(value.type);
  const kindUi = columnTypeKindClasses(kind);
  const intOk = isIntegerAutoIncrementType(value.type);
  const boolOk = isBooleanBitType(value.type);
  const size = parseTypeSize(value.type);
  const boolDefaults = useMemo(
    () => dialectBooleanDefaultOptions(dialect),
    [dialect]
  );

  const setType = (type: string) => {
    let next: BlueprintColumn = { ...value, type };
    if (value.identity && !isIntegerAutoIncrementType(type)) {
      next = withAutoIncrement(next, false);
    }
    // Clear incompatible boolean defaults when leaving boolean
    if (!isBooleanBitType(type) && value.defaultValue) {
      const allowed = new Set(dialectBooleanDefaultOptions(dialect).map((d) => d.value));
      if (allowed.has(value.defaultValue) && /^(TRUE|FALSE|1|0|NULL)$/i.test(value.defaultValue)) {
        // keep numeric defaults for ints; only clear TRUE/FALSE when leaving bool
        if (/^(TRUE|FALSE)$/i.test(value.defaultValue) && !isBooleanBitType(type)) {
          next = { ...next, defaultValue: undefined };
        }
      }
    }
    onChange(next);
  };

  const groups = useMemo(() => {
    const map = new Map<string, typeof typeOptions>();
    for (const opt of typeOptions) {
      const list = map.get(opt.group) ?? [];
      list.push(opt);
      map.set(opt.group, list);
    }
    return [...map.entries()];
  }, [typeOptions]);

  return (
    <div className="flex flex-col gap-2" data-testid="blueprint-column-form">
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${kindUi.badge}`}
        >
          {kindUi.label}
        </span>
        <span className="text-[10px] text-slate-500">{constraints.hint}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Name</span>
          <input
            value={value.name}
            disabled={nameLocked}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12px] font-mono text-slate-200 outline-none focus:border-cyan-600 disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-0.5 min-w-0 sm:col-span-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">
            Type ({dialect})
          </span>
          <select
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM_TYPE) {
                setForceCustom(true);
                return;
              }
              setForceCustom(false);
              setType(v);
            }}
            data-testid="blueprint-type-select"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12px] font-mono text-slate-200 outline-none focus:border-cyan-600"
          >
            {groups.map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                    {opt.integerLike ? ' · auto-inc' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM_TYPE}>Custom…</option>
          </select>
          {selectValue === CUSTOM_TYPE && (
            <input
              value={value.type}
              onChange={(e) => setType(e.target.value)}
              placeholder="custom type"
              data-testid="blueprint-type-custom"
              className="mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12px] font-mono text-slate-200 outline-none focus:border-cyan-600"
            />
          )}
        </label>

        {boolOk ? (
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Default</span>
            <select
              value={value.defaultValue ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  defaultValue: e.target.value ? e.target.value : undefined,
                })
              }
              data-testid="blueprint-bool-default"
              className="bg-slate-900 border border-emerald-500/40 rounded px-2 py-1 text-[12px] font-mono text-emerald-100 outline-none focus:border-emerald-400"
            >
              {boolDefaults.map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Default</span>
            <input
              value={value.defaultValue ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  defaultValue: e.target.value.trim() ? e.target.value : undefined,
                })
              }
              placeholder="—"
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12px] font-mono text-slate-200 outline-none focus:border-cyan-600"
            />
          </label>
        )}
      </div>

      {/* Length / precision */}
      {size.kind === 'length' && (
        <label className="flex items-center gap-2 text-[12px] text-amber-100">
          <span className="text-[10px] font-bold text-amber-400/90 uppercase shrink-0">Length</span>
          <input
            type="number"
            min={1}
            value={size.length ?? ''}
            placeholder="e.g. 255"
            data-testid="blueprint-type-length"
            onChange={(e) => {
              const n = e.target.value === '' ? undefined : Number(e.target.value);
              setType(applyTypeSize(value.type, { length: n }));
            }}
            className="w-28 bg-slate-900 border border-amber-500/35 rounded px-2 py-1 text-[12px] font-mono text-amber-50 outline-none focus:border-amber-400"
          />
          <span className="text-[11px] font-mono text-slate-500">{value.type}</span>
        </label>
      )}
      {size.kind === 'decimal' && (
        <div className="flex items-center gap-3 flex-wrap text-[12px] text-cyan-100">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-cyan-400/90 uppercase">Precision</span>
            <input
              type="number"
              min={1}
              value={size.precision ?? ''}
              placeholder="10"
              data-testid="blueprint-type-precision"
              onChange={(e) => {
                const precision = e.target.value === '' ? undefined : Number(e.target.value);
                setType(
                  applyTypeSize(value.type, {
                    precision,
                    scale: size.scale,
                  })
                );
              }}
              className="w-20 bg-slate-900 border border-cyan-500/35 rounded px-2 py-1 text-[12px] font-mono outline-none focus:border-cyan-400"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-cyan-400/90 uppercase">Scale</span>
            <input
              type="number"
              min={0}
              value={size.scale ?? ''}
              placeholder="2"
              data-testid="blueprint-type-scale"
              onChange={(e) => {
                const scale = e.target.value === '' ? undefined : Number(e.target.value);
                setType(
                  applyTypeSize(value.type, {
                    precision: size.precision,
                    scale,
                  })
                );
              }}
              className="w-20 bg-slate-900 border border-cyan-500/35 rounded px-2 py-1 text-[12px] font-mono outline-none focus:border-cyan-400"
            />
          </label>
          <span className="text-[11px] font-mono text-slate-500">{value.type}</span>
        </div>
      )}

      {/* Auto-inc only for integers */}
      {intOk && (
        <div
          className="flex flex-col gap-1.5 rounded-md border border-violet-500/30 bg-violet-950/25 px-2.5 py-2"
          data-testid="blueprint-auto-increment"
        >
          <label className="flex items-center gap-2 text-[12px] text-violet-100 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={!!value.identity}
              onChange={(e) => onChange(withAutoIncrement(value, e.target.checked))}
              className="w-4 h-4 accent-violet-500"
            />
            Auto increment
            <span className="text-[10px] font-mono font-medium text-violet-300/90">
              → {identityUi.clauseHint}
            </span>
          </label>
          {value.identity && identityUi.generations && (
            <select
              value={value.identityGeneration ?? 'ALWAYS'}
              onChange={(e) =>
                onChange({
                  ...value,
                  identityGeneration: e.target.value as 'ALWAYS' | 'BY DEFAULT',
                })
              }
              className="ml-6 max-w-[200px] bg-slate-900 border border-violet-500/40 rounded px-2 py-1 text-[11px] font-mono text-violet-100 outline-none"
            >
              {identityUi.generations.map((g) => (
                <option key={g} value={g}>
                  GENERATED {g}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Constraints */}
      <div className="flex items-center gap-3 flex-wrap">
        {constraints.notNull && (
          <label className="flex items-center gap-1.5 text-[12px] text-slate-300 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={!value.nullable}
              onChange={(e) => onChange({ ...value, nullable: !e.target.checked })}
              className="w-3.5 h-3.5 accent-cyan-500"
            />
            NOT NULL
          </label>
        )}
        {constraints.unique && (
          <label className="flex items-center gap-1.5 text-[12px] text-slate-300 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={!!value.unique}
              onChange={(e) => onChange({ ...value, unique: e.target.checked })}
              className="w-3.5 h-3.5 accent-amber-500"
              data-testid="blueprint-unique"
            />
            UNIQUE
          </label>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-2.5 py-1 text-[11px] font-bold rounded border border-cyan-500/35 text-cyan-300 bg-cyan-950/40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
