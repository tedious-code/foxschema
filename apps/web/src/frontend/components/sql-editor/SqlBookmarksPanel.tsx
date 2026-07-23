import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';

/**
 * Persist named SQL scripts. Save is on the sidebar section header; open loads
 * into a new tab (or focuses an already-linked tab).
 */
export const SqlBookmarksPanel: React.FC = () => {
  const bookmarks = useSqlEditorStore((s) => s.bookmarks);
  const openBookmark = useSqlEditorStore((s) => s.openBookmark);
  const renameBookmark = useSqlEditorStore((s) => s.renameBookmark);
  const deleteBookmark = useSqlEditorStore((s) => s.deleteBookmark);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const commitRename = () => {
    if (!editingId) return;
    renameBookmark(editingId, draft);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-1.5 min-h-0 flex-1" data-testid="sql-bookmarks">
      {bookmarks.length === 0 ? (
        <p className="text-[11px] text-slate-500 leading-snug">
          Save a named script to reopen later. Rename the tab first so the bookmark keeps a clear
          title.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pr-0.5">
          {bookmarks.map((b) => (
            <li
              key={b.id}
              className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-900/60"
            >
              {editingId === b.id ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 min-w-0 bg-slate-950 border border-cyan-600/50 rounded px-1.5 py-0.5 text-[11px] text-slate-100 outline-none"
                />
              ) : (
                <button
                  type="button"
                  data-testid={`sql-bookmark-open-${b.id}`}
                  title={b.sql.slice(0, 200) || '(empty)'}
                  onClick={() => openBookmark(b.id)}
                  className="flex-1 min-w-0 text-left text-[11px] text-slate-300 hover:text-cyan-300 truncate"
                >
                  {b.title}
                </button>
              )}
              <button
                type="button"
                title="Rename bookmark"
                aria-label={`Rename ${b.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(b.id);
                  setDraft(b.title);
                }}
                className="p-0.5 text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                data-testid={`sql-bookmark-delete-${b.id}`}
                title="Delete bookmark"
                aria-label={`Delete ${b.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBookmark(b.id);
                }}
                className="p-0.5 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
