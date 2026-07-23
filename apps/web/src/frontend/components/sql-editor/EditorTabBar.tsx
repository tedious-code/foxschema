import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import type { SqlTab } from '../../store/sqlEditorTabLogic';

interface Props {
  tabs: SqlTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
}

/**
 * Multi-tab bar for the SQL Editor. Rename via double-click or the pencil;
 * middle-click or × closes. Always keeps at least one tab (store replaces the last).
 */
export const EditorTabBar: React.FC<Props> = ({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onAdd,
  onRename,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const startEdit = (tab: SqlTab, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(tab.id);
    setDraft(tab.title);
  };

  const commitEdit = () => {
    if (!editingId) return;
    onRename(editingId, draft);
    setEditingId(null);
  };

  return (
    <div
      className="flex items-stretch gap-0 border-b border-slate-800 bg-slate-950/40 overflow-x-auto"
      data-testid="sql-editor-tabs"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => startEdit(tab)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            title="Double-click or use pencil to rename"
            className={`group flex items-center gap-1 pl-3 pr-1.5 py-1.5 text-[11px] font-semibold border-r border-slate-800/80 cursor-pointer shrink-0 max-w-[12rem] ${
              active
                ? 'bg-slate-900 text-slate-100 border-b-2 border-b-cyan-500 -mb-px'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900/40'
            }`}
          >
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                data-testid="sql-tab-rename"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-slate-950 border border-cyan-600/50 rounded px-1 py-0 text-[11px] outline-none w-28 text-slate-100"
              />
            ) : (
              <>
                <span className="truncate" title={tab.title}>
                  {tab.title}
                </span>
                <button
                  type="button"
                  data-testid={`sql-tab-rename-btn-${tab.id}`}
                  aria-label={`Rename ${tab.title}`}
                  title="Rename query"
                  onClick={(e) => startEdit(tab, e)}
                  className={`p-0.5 rounded transition shrink-0 ${
                    active
                      ? 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'
                      : 'opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300'
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </>
            )}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={`p-0.5 rounded transition ${
                active
                  ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                  : 'opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300'
              }`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="sql-tab-add"
        onClick={onAdd}
        title="New tab"
        aria-label="New tab"
        className="px-2 text-slate-500 hover:text-slate-200 hover:bg-slate-900/40 transition shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
