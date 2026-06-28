import React, { useEffect, useState, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { X, History, RefreshCw, Trash2, Download, Database } from 'lucide-react';
import {
  apiListMigrations,
  apiGetMigration,
  apiDeleteMigration,
  type MigrationRunSummary,
  type MigrationRunDetail,
  type MigrationRunStatus,
} from '../api/migrationApi';

const SqlEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })));

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS: Record<MigrationRunStatus, { label: string; cls: string }> = {
  SUCCESS: { label: 'Success', cls: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/25' },
  FAILED: { label: 'Failed', cls: 'text-rose-400 bg-rose-950/40 border-rose-500/25' },
  ROLLED_BACK: { label: 'Rolled back', cls: 'text-amber-400 bg-amber-950/40 border-amber-500/25' },
  RUNNING: { label: 'Running', cls: 'text-cyan-400 bg-cyan-950/40 border-cyan-500/25' },
};

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');
const safe = (s?: string) => (s ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';

const StatusBadge: React.FC<{ status: MigrationRunStatus }> = ({ status }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS[status].cls}`}>{STATUS[status].label}</span>
);

/** Per-user log of executed migrations, with the script, snapshot, and results. */
export const MigrationHistory: React.FC<Props> = ({ open, onClose }) => {
  const [runs, setRuns] = useState<MigrationRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MigrationRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = async () => {
    setLoading(true);
    try {
      const list = await apiListMigrations();
      setRuns(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiGetMigration(selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  if (!open) return null;

  const remove = async (id: string) => {
    await apiDeleteMigration(id).catch(() => undefined);
    setRuns((rs) => rs.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const downloadSnapshot = (d: MigrationRunDetail) => {
    if (!d.snapshotDdl) return;
    const url = URL.createObjectURL(new Blob([d.snapshotDdl], { type: 'text/sql' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot_${safe(d.host)}_${safe(d.database)}_${safe(d.schema)}_${d.startedAt.replace(/[:.]/g, '-')}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-[1000px] h-[80vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-slate-100 font-bold text-base">Migration History</h2>
              <p className="text-xs text-slate-400 mt-0.5">Every executed sync, with its script, snapshot, and results</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={loadList} title="Refresh" className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Run list */}
          <div className="w-72 shrink-0 border-r border-slate-800 overflow-y-auto">
            {runs.length === 0 ? (
              <div className="text-center py-12 px-4 text-slate-500 text-sm">
                <Database className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                {loading ? 'Loading…' : 'No migrations executed yet.'}
              </div>
            ) : (
              runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-850 transition cursor-pointer ${
                    selectedId === r.id ? 'bg-slate-800/70' : 'hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-[10px] text-slate-500 shrink-0">{r.objectCount} obj</span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono truncate mt-1.5" title={`${r.host} / ${r.database} / ${r.schema}`}>
                    {r.database}{r.schema ? ` / ${r.schema}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{fmt(r.startedAt)}</p>
                </button>
              ))
            )}
          </div>

          {/* Detail */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {!detail ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                {detailLoading ? 'Loading…' : 'Select a migration to view details.'}
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={detail.status} />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/50">
                        {detail.dialect.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-400">{detail.objectCount} object(s)</span>
                    </div>
                    <p className="text-sm text-slate-200 font-mono mt-2 break-all">
                      {detail.host} / {detail.database}{detail.schema ? ` / ${detail.schema}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Started {fmt(detail.startedAt)} · Finished {fmt(detail.finishedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {detail.snapshotDdl && (
                      <button
                        onClick={() => downloadSnapshot(detail)}
                        title="Download pre-migration snapshot"
                        className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-2 py-1 hover:bg-slate-800 transition"
                      >
                        <Download className="w-3.5 h-3.5" /> Snapshot
                      </button>
                    )}
                    <button
                      onClick={() => remove(detail.id)}
                      title="Delete this record"
                      className="p-1.5 text-slate-500 hover:text-rose-300 hover:bg-rose-950/20 rounded transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {detail.error && (
                  <div className="text-xs text-rose-300 bg-rose-950/20 border border-rose-500/20 rounded-lg px-3 py-2 font-mono break-all">
                    {detail.error}
                  </div>
                )}

                {/* Per-object results */}
                {detail.results.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">Objects</p>
                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                            <th className="p-2.5 font-semibold">Object</th>
                            <th className="p-2.5 font-semibold">Action</th>
                            <th className="p-2.5 font-semibold text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850">
                          {detail.results.map((r, i) => (
                            <tr key={`${r.name}-${i}`}>
                              <td className="p-2.5 font-mono text-slate-200">{r.name} <span className="text-slate-600">{r.type}</span></td>
                              <td className="p-2.5 text-slate-400">{r.action}</td>
                              <td className={`p-2.5 text-right font-semibold ${r.status === 'FAILED' ? 'text-rose-400' : r.status === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-400'}`}>
                                {r.status}{r.error ? ` · ${r.error}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Executed script */}
                {detail.script && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">Executed Script</p>
                    <div className="bg-slate-950 border border-slate-850 rounded-lg overflow-hidden h-72">
                      <Suspense fallback={<div className="p-4 text-xs text-slate-500">Loading editor…</div>}>
                        <SqlEditor value={detail.script} dialect={detail.dialect} />
                      </Suspense>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
