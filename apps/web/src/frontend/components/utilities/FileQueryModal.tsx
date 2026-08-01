/**
 * Utilities → Query files: import CSV / JSON / fixed-width text into a
 * temporary SQLite DB and query it from the SQL Editor.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, Loader2, X } from 'lucide-react';
import {
  importFileForQuery,
  type FileQueryFormat,
  type TextOffsetColumn,
} from '../../api/fileQueryApi';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { insertAtCursor } from '../sql-editor/sqlEditorBridge';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';
import { toast } from '../../store/toastStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMPTY_OFFSETS: TextOffsetColumn[] = [
  { name: 'col1', start: 0, length: 10 },
  { name: 'col2', start: 10, length: 20 },
];

export const FileQueryModal: React.FC<Props> = ({ open, onClose }) => {
  const loadConnections = useSyncStore((s) => s.loadConnections);
  const ensureConnectionSelected = useSqlEditorStore((s) => s.ensureConnectionSelected);
  const setSql = useSqlEditorStore((s) => s.setSql);
  const activeTabId = useSqlEditorStore((s) => s.activeTabId);
  const tabs = useSqlEditorStore((s) => s.tabs);

  const [format, setFormat] = useState<FileQueryFormat>('csv');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [tableName, setTableName] = useState('');
  const [delimiter, setDelimiter] = useState(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [jsonMode, setJsonMode] = useState<'array' | 'ndjson'>('array');
  const [skipLines, setSkipLines] = useState(0);
  const [offsetsText, setOffsetsText] = useState(
    EMPTY_OFFSETS.map((c) => `${c.name},${c.start},${c.length}`).join('\n')
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  const onPickFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    if (!tableName) {
      setTableName(file.name.replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '_'));
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.ndjson')) setFormat('json');
    else if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
      setFormat('csv');
      if (lower.endsWith('.tsv')) setDelimiter('\t');
    } else if (lower.endsWith('.txt') || lower.endsWith('.dat')) setFormat('text');
    setContent(await file.text());
  }, [tableName]);

  const parseOffsets = (): TextOffsetColumn[] => {
    const lines = offsetsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line, i) => {
      const [name, startS, lenS] = line.split(/[,\t]/).map((s) => s.trim());
      const start = Number(startS);
      const length = Number(lenS);
      if (!name || !Number.isFinite(start) || !Number.isFinite(length)) {
        throw new Error(
          `Offset line ${i + 1} must be: name,start,length (e.g. id,0,5)`
        );
      }
      return { name, start, length };
    });
  };

  const onImport = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!content.trim()) throw new Error('Choose a file or paste content first');
      const body = {
        format,
        fileName: fileName || 'data.txt',
        content,
        tableName: tableName || undefined,
        csv: format === 'csv' ? { delimiter, hasHeader } : undefined,
        json: format === 'json' ? { mode: jsonMode } : undefined,
        text:
          format === 'text'
            ? { skipLines, columns: parseOffsets() }
            : undefined,
      };
      const res = await importFileForQuery(body);
      if (!res.ok || !res.connection) throw new Error(res.error || 'Import failed');

      await loadConnections();
      ensureConnectionSelected(res.connection.id);
      if (res.sampleSql) {
        const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
        if (!tab?.sql?.trim()) setSql(res.sampleSql);
        else insertAtCursor(`\n${res.sampleSql}`);
      }
      toast({
        tone: 'success',
        title: `Loaded ${res.rowCount ?? 0} row(s)`,
        body: `"${res.connection.name}" is checked — run the sample SELECT.`,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[280] flex items-center justify-center bg-slate-950/70 backdrop-blur-[2px] p-4"
      data-testid="file-query-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-slate-100 font-semibold">
            <FileSpreadsheet className="w-4 h-4 text-amber-400" strokeWidth={SQL_ICON_STROKE} />
            Query files
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 text-xs text-slate-300 max-h-[70vh] overflow-y-auto">
          <p className="text-slate-400 leading-relaxed">
            Import CSV, JSON, or fixed-width text into a temporary SQLite database, then
            run normal SQL against it in the editor. Files are kept under a temp folder
            for about 24 hours.
          </p>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              File
            </span>
            <input
              type="file"
              data-testid="file-query-input"
              accept=".csv,.tsv,.json,.ndjson,.txt,.dat,text/csv,application/json,text/plain"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Format
              </span>
              <select
                data-testid="file-query-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as FileQueryFormat)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="text">Text (offsets)</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Table name
              </span>
              <input
                data-testid="file-query-table"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="data"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 font-mono"
              />
            </label>
          </div>

          {format === 'csv' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Delimiter
                </span>
                <input
                  value={delimiter === '\t' ? '\\t' : delimiter}
                  onChange={(e) =>
                    setDelimiter(e.target.value === '\\t' ? '\t' : e.target.value.slice(0, 1) || ',')
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono"
                />
              </label>
              <label className="flex items-end gap-2 pb-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>First row is header</span>
              </label>
            </div>
          )}

          {format === 'json' && (
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                JSON shape
              </span>
              <select
                value={jsonMode}
                onChange={(e) => setJsonMode(e.target.value as 'array' | 'ndjson')}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
              >
                <option value="array">Array of objects</option>
                <option value="ndjson">NDJSON (one object per line)</option>
              </select>
            </label>
          )}

          {format === 'text' && (
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Skip lines
                </span>
                <input
                  type="number"
                  min={0}
                  value={skipLines}
                  onChange={(e) => setSkipLines(Number(e.target.value) || 0)}
                  className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Columns (name,start,length)
                </span>
                <textarea
                  data-testid="file-query-offsets"
                  value={offsetsText}
                  onChange={(e) => setOffsetsText(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px]"
                />
              </label>
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Preview / paste
            </span>
            <textarea
              data-testid="file-query-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="Paste file contents here, or choose a file above…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-slate-200"
            />
          </label>

          {error && (
            <p className="text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-md px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="file-query-import"
            disabled={busy}
            onClick={() => void onImport()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-600/50 bg-amber-900/50 text-amber-100 hover:bg-amber-800/60 font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Import & open
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
