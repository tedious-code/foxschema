import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Sparkles, Eye, EyeOff } from 'lucide-react';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { SQL_EDITOR_SAMPLE_BOOKMARKS } from '../../lib/sqlEditorSamples';
import { SQL_ICON_STROKE } from './sqlIconStyle';

/**
 * Persist named SQL scripts. Save is on the sidebar section header; open loads
 * into a new tab (or focuses an already-linked tab).
 *
 * The built-in ★ samples can be hidden: they are useful once, then mostly get
 * in the way of a user's own scripts. Hiding is a view filter — the bookmarks
 * themselves stay installed, so nothing is lost and Refresh still works.
 */
const HIDE_SAMPLES_KEY = 'foxschema-sql-bookmarks-hide-samples';

function readHideSamples(): boolean {
  try {
    return localStorage.getItem(HIDE_SAMPLES_KEY) === '1';
  } catch {
    return false;
  }
}
export const SqlBookmarksPanel: React.FC = () => {
  const bookmarks = useSqlEditorStore((s) => s.bookmarks);
  const openBookmark = useSqlEditorStore((s) => s.openBookmark);
  const renameBookmark = useSqlEditorStore((s) => s.renameBookmark);
  const deleteBookmark = useSqlEditorStore((s) => s.deleteBookmark);
  const installSampleBookmarks = useSqlEditorStore((s) => s.installSampleBookmarks);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [hideSamples, setHideSamples] = useState<boolean>(readHideSamples);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleHideSamples = () => {
    setHideSamples((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HIDE_SAMPLES_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const commitRename = () => {
    if (!editingId) return;
    renameBookmark(editingId, draft);
    setEditingId(null);
  };

  const onInstallSamples = () => {
    const n = installSampleBookmarks();
    // Installing while hidden would look like nothing happened.
    if (hideSamples) toggleHideSamples();
    setSampleNote(
      n > 0
        ? `Added/updated ${n} sample bookmark${n === 1 ? '' : 's'}`
        : 'Sample bookmarks already up to date'
    );
    window.setTimeout(() => setSampleNote(null), 2500);
  };

  const sampleIds = new Set(SQL_EDITOR_SAMPLE_BOOKMARKS.map((s) => s.id));
  const hasAllSamples = SQL_EDITOR_SAMPLE_BOOKMARKS.every((s) =>
    bookmarks.some((b) => b.id === s.id)
  );
  const installedSampleCount = bookmarks.filter((b) => sampleIds.has(b.id)).length;
  const visible = hideSamples ? bookmarks.filter((b) => !sampleIds.has(b.id)) : bookmarks;

  return (
    <div className="flex flex-col gap-1.5 min-h-0 flex-1" data-testid="sql-bookmarks">
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          data-testid="sql-bookmark-install-samples"
          title="Install built-in JS/TS/Node code-cell examples you can open later"
          onClick={onInstallSamples}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-cyan-400/90 hover:text-cyan-300 hover:bg-slate-800/80 transition"
        >
          <Sparkles className="w-3 h-3 text-violet-400" strokeWidth={SQL_ICON_STROKE} />
          {hasAllSamples ? 'Refresh samples' : 'Add samples'}
        </button>
        {installedSampleCount > 0 && (
          <button
            type="button"
            data-testid="sql-bookmark-toggle-samples"
            title={
              hideSamples
                ? `Show ${installedSampleCount} sample bookmark${installedSampleCount === 1 ? '' : 's'}`
                : `Hide ${installedSampleCount} sample bookmark${installedSampleCount === 1 ? '' : 's'} (they stay installed)`
            }
            aria-pressed={hideSamples}
            onClick={toggleHideSamples}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition"
          >
            {hideSamples ? (
              <EyeOff className="w-3 h-3 text-slate-400" strokeWidth={SQL_ICON_STROKE} />
            ) : (
              <Eye className="w-3 h-3 text-slate-400" strokeWidth={SQL_ICON_STROKE} />
            )}
            {hideSamples ? `Samples (${installedSampleCount})` : 'Hide samples'}
          </button>
        )}
        {sampleNote && (
          <span className="text-[10px] font-medium text-slate-500 truncate">{sampleNote}</span>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-[12px] font-medium text-slate-500 leading-snug">
          {bookmarks.length === 0
            ? 'Save a named script to reopen later, or add the built-in JS/TS/Node samples above.'
            : 'Only sample bookmarks here — use Samples above to show them, or save your own script.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pr-0.5">
          {visible.map((b) => (
            <li
              key={b.id}
              className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-800/60"
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
                  className="flex-1 min-w-0 bg-slate-950 border border-cyan-600/50 rounded px-1.5 py-0.5 text-[12px] font-semibold text-slate-100 outline-none"
                />
              ) : (
                <button
                  type="button"
                  data-testid={`sql-bookmark-open-${b.id}`}
                  title={b.sql.slice(0, 200) || '(empty)'}
                  onClick={() => openBookmark(b.id)}
                  className={`flex-1 min-w-0 text-left text-[13px] font-semibold truncate ${
                    sampleIds.has(b.id)
                      ? 'text-cyan-300/90 hover:text-cyan-200'
                      : 'text-slate-300 hover:text-cyan-300'
                  }`}
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
                className="p-0.5 text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition"
              >
                <Pencil className="w-3.5 h-3.5 text-sky-400" strokeWidth={SQL_ICON_STROKE} />
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
                className="p-0.5 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 className="w-3 h-3 text-rose-400" strokeWidth={SQL_ICON_STROKE} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
