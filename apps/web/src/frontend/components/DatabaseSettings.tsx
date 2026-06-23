import React, { useState } from 'react';
import { ShieldCheck, HardDrive, Server, Loader2, CheckCircle2, AlertCircle, RotateCw, FolderOpen } from 'lucide-react';
import { isTauri, setApiBase } from '../api/apiBase';
import { testDbConnection, updateDbConfig, pickDbLocation, type AppInfo, type DbEngine } from '../api/setupApi';

const ENGINES: { id: DbEngine; label: string }[] = [
  { id: 'sqlite', label: 'SQLite' },
  { id: 'postgres', label: 'Postgres' },
  { id: 'mysql', label: 'MySQL' },
];

const URL_PLACEHOLDER: Record<DbEngine, string> = {
  sqlite: '',
  postgres: 'postgres://user:pass@host:5432/dbname',
  mysql: 'mysql://user:pass@host:3306/dbname',
};

/**
 * Database engine configuration in Settings. New installs run on SQLite; here a
 * user can switch the app's own metadata store to their Postgres/MySQL server.
 * Desktop-only (the switch respawns the sidecar via Tauri); the web edition shows
 * the engine read-only since it's managed by the server.
 */
export const DatabaseSettings: React.FC<{ info: AppInfo }> = ({ info }) => {
  const currentEngine = (info.db.engine as DbEngine) || 'sqlite';
  const currentLocation = info.db.location === '(default)' ? '' : info.db.location;

  const [engine, setEngine] = useState<DbEngine>(currentEngine);
  const [dbUrl, setDbUrl] = useState(currentEngine !== 'sqlite' ? currentLocation : '');
  const [dbPath, setDbPath] = useState(currentEngine === 'sqlite' ? currentLocation : '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSqlite = engine === 'sqlite';

  // Read-only on the web (server-managed) or for the legacy single-user setups.
  if (!isTauri()) {
    return (
      <p className="text-xs text-slate-300">
        <span className="font-mono text-slate-200">{info.db.engine}</span>
        {info.db.location && info.db.location !== '(default)' ? ` · ${info.db.location}` : ''} — managed by the server.
      </p>
    );
  }

  const baseline = currentEngine !== 'sqlite' ? currentLocation : '';
  const baselinePath = currentEngine === 'sqlite' ? currentLocation : '';
  const changed =
    engine !== currentEngine ||
    (!isSqlite && dbUrl.trim() !== baseline) ||
    (isSqlite && dbPath.trim() !== baselinePath);
  const canApply = !applying && changed && (isSqlite || testResult?.ok === true);

  const resetTest = () => setTestResult(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testDbConnection(engine, dbUrl.trim() || undefined, dbPath.trim() || undefined));
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const browse = async () => {
    try {
      const picked = await pickDbLocation(dbPath || undefined);
      if (picked) {
        setDbPath(picked);
        resetTest();
      }
    } catch {
      /* dialog cancelled / unavailable — keep the typed value */
    }
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const state = await updateDbConfig({
        engine,
        dbPath: isSqlite ? dbPath.trim() || undefined : undefined,
        dbUrl: isSqlite ? undefined : dbUrl.trim() || undefined,
      });
      setApiBase(state.api_base);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch database');
      setApplying(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {ENGINES.map((eng) => (
          <button
            key={eng.id}
            type="button"
            onClick={() => {
              setEngine(eng.id);
              resetTest();
            }}
            className={`py-1.5 rounded-md text-xs font-semibold border transition ${
              engine === eng.id
                ? 'bg-slate-800 border-cyan-500/40 text-slate-100'
                : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            {eng.label}
          </button>
        ))}
      </div>

      {isSqlite ? (
        <div className="flex items-center gap-2 text-xs">
          <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="text"
            value={dbPath}
            spellCheck={false}
            placeholder="(default location)"
            onChange={(e) => {
              setDbPath(e.target.value);
              resetTest();
            }}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-2.5 py-1.5 font-mono text-[11px] outline-none"
          />
          <button
            type="button"
            onClick={browse}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition"
          >
            <FolderOpen className="w-3.5 h-3.5" /> Browse
          </button>
        </div>
      ) : (
        <label className="flex items-center gap-2 text-xs">
          <Server className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="text"
            value={dbUrl}
            spellCheck={false}
            placeholder={URL_PLACEHOLDER[engine]}
            onChange={(e) => {
              setDbUrl(e.target.value);
              resetTest();
            }}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-2.5 py-1.5 font-mono text-[11px] outline-none"
          />
        </label>
      )}

      {!isSqlite && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !dbUrl.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Test connection
          </button>
          {testResult?.ok && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Connected
            </span>
          )}
          {testResult && !testResult.ok && (
            <span className="flex items-center gap-1 text-xs text-rose-400 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{testResult.error || 'Failed'}</span>
            </span>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        FoxSchema stores its own data (connections, history, settings) here, encrypted with your keychain key.
        Switching engines restarts the app and starts an empty store on the new database — existing data isn't copied.
      </p>

      {error && (
        <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold accent-grad on-accent-fg rounded-md transition disabled:opacity-40"
      >
        {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
        {applying ? 'Switching…' : changed ? 'Apply & restart' : 'No changes'}
      </button>
    </div>
  );
};
