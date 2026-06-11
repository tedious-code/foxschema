import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { ConnectionOptions } from "../../backend/interfaces/schema-provider.interface";
import { buildConnectionString, DEFAULT_PORTS } from "../../backend/cores/connection-string";
import { getProviderSettings } from "../../backend/providers/provider-settings";
import { testConnection as apiTestConnection } from "../api/schemaApi";

interface Props {
  open: boolean;
  dialect: 'postgres' | 'mysql' | 'db2';
  initialOptions?: ConnectionOptions;
  onClose: () => void;
  onSave: (options: ConnectionOptions) => void;
}

const defaultPorts = DEFAULT_PORTS;

export const ConnectionModal: React.FC<Props> = ({
  open,
  dialect,
  initialOptions,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<ConnectionOptions>({
    host: 'localhost',
    port: 5432,
    database: '',
    schema: '',
    username: '',
    password: '',
    ssl: { enabled: false },
    pool: { min: 1, max: 10 },
  });

  const [testingState, setTestingState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'failed';
    error?: string;
  }>({ status: 'idle' });

  // Reset form when modal opens or dialect changes
  useEffect(() => {
    if (open) {
      setForm({
        host: initialOptions?.host || 'localhost',
        port: initialOptions?.port || defaultPorts[dialect],
        database: initialOptions?.database || '',
        schema: initialOptions?.schema || getProviderSettings(dialect).defaultSchema || '',
        username: initialOptions?.username || '',
        password: initialOptions?.password || '',
        ssl: {
          enabled: initialOptions?.ssl?.enabled || false,
        },
        pool: {
          min: initialOptions?.pool?.min || 1,
          max: initialOptions?.pool?.max || 10,
        },
      });
      setTestingState({ status: 'idle' });
    }
  }, [open, dialect, initialOptions]);

  if (!open) return null;

  const updateField = (key: keyof ConnectionOptions, value: any) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Apply Config tests first and only saves a working connection —
  // on failure the modal stays open showing the error
  const handleSave = async () => {
    const options: ConnectionOptions = {
      ...form,
      connectionString: buildConnectionString(dialect, form),
    };

    setTestingState({ status: 'testing' });
    try {
      const success = await apiTestConnection(dialect, options);
      if (!success) {
        setTestingState({ status: 'failed', error: 'Connection returned false' });
        return;
      }
    } catch (error: any) {
      setTestingState({ status: 'failed', error: error.message || 'Connection failed' });
      return;
    }

    setTestingState({ status: 'success' });
    onSave(options);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
      <div
        className="w-full max-w-[500px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div>
            <h2 className="text-white font-bold text-base">
              Connection Parameters
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Configure options for {dialect.toUpperCase()}</p>
          </div>

          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Host</label>
              <input
                placeholder="localhost"
                value={form.host}
                onChange={(e) => updateField('host', e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Port</label>
              <input
                type="number"
                placeholder={String(defaultPorts[dialect])}
                value={form.port}
                onChange={(e) => updateField('port', Number(e.target.value))}
                className="mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Database Name</label>
              <input
                placeholder="my_database"
                value={form.database}
                onChange={(e) => updateField('database', e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Schema</label>
              <input
                placeholder={getProviderSettings(dialect).defaultSchema || (dialect === 'mysql' ? 'n/a' : 'SCHEMA')}
                value={form.schema}
                onChange={(e) => updateField('schema', e.target.value)}
                disabled={dialect === 'mysql'}
                title={dialect === 'mysql' ? 'MySQL uses the database as the schema' : 'Schema to compare (sets CURRENTSCHEMA / search_path)'}
                className="mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono disabled:opacity-40 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Username</label>
              <input
                placeholder="postgres"
                value={form.username}
                onChange={(e) => updateField('username', e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2.5 text-xs text-slate-350 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.ssl?.enabled}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    ssl: {
                      ...prev.ssl,
                      enabled: e.target.checked,
                    },
                  }))
                }
                className="w-4 h-4 rounded border-slate-800 bg-slate-950 text-cyan-600 focus:ring-0 focus:ring-offset-0"
              />
              Enable SSL Connection
            </label>
          </div>

          {/* Inline Test Result Alert */}
          {testingState.status !== 'idle' && (
            <div className={`mt-3 p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
              testingState.status === 'testing'
                ? 'bg-slate-950/40 border-slate-800 text-slate-400'
                : testingState.status === 'success'
                ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-950/20 border-rose-500/20 text-rose-400'
            }`}>
              {testingState.status === 'testing' && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0 mt-0.5" />}
              {testingState.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
              {testingState.status === 'failed' && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
              
              <div>
                <p className="font-semibold">
                  {testingState.status === 'testing' && 'Testing Connection...'}
                  {testingState.status === 'success' && 'Connection Successful!'}
                  {testingState.status === 'failed' && 'Connection Failed'}
                </p>
                {testingState.error && <p className="mt-1 text-slate-400 font-mono text-[10px] leading-relaxed break-all">{testingState.error}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end items-center gap-2 px-6 py-4 bg-slate-950/60 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-850/50 rounded transition"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={testingState.status === 'testing'}
            className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 rounded transition shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-wait flex items-center gap-1.5"
          >
            {testingState.status === 'testing' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...
              </>
            ) : (
              'Apply & Connect'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};