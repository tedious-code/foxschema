import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle, AlertTriangle, Loader2, ListTree, Download } from "lucide-react";
import { type ConnectionOptions, type Dialect, buildConnectionString, DEFAULT_PORTS, getProviderSettings, PROVIDER_SETTINGS } from '../lib/provider-settings';
import type { DriverInfo } from '../lib/types';
import { fetchSchemaList, checkDriver as apiCheckDriver, installDriver as apiInstallDriver } from "../api/schemaApi";


interface CredentialInput {
  name: string;
  dialect: string;
  schema?: string;
  option: ConnectionOptions;
  savePassword: boolean;
}

interface Props {
  open: boolean;
  dialect: Dialect;
  initialOptions?: ConnectionOptions;
  /** 'side' binds to source/target; 'credential' defines a reusable saved credential. */
  mode?: 'side' | 'credential';
  initialName?: string;
  /** Edit mode: whether the saved credential currently has a stored password. */
  initialHasPassword?: boolean;
  onClose: () => void;
  onSave?: (options: ConnectionOptions, dialect: Dialect) => void;
  onSaveCredential?: (input: CredentialInput) => Promise<void>;
}

const defaultPorts = DEFAULT_PORTS;
const dialectOptions = Object.values(PROVIDER_SETTINGS);

const MAX_NAME_LEN = 50;
// Credential names allow letters, numbers, spaces, hyphen and underscore only —
// no other special characters (keeps them safe as labels / dropdown entries).
const sanitizeName = (raw: string) => raw.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, MAX_NAME_LEN);

export const ConnectionModal: React.FC<Props> = ({
  open,
  dialect,
  initialOptions,
  mode = 'side',
  initialName,
  initialHasPassword,
  onClose,
  onSave,
  onSaveCredential,
}) => {
  const isCredential = mode === 'credential';
  const [selDialect, setSelDialect] = useState<Dialect>(dialect);
  const [name, setName] = useState('');
  // Off by default (opt-in). On edit, reflect whether a password is already stored.
  const [savePassword, setSavePassword] = useState(false);
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

  const [schemaList, setSchemaList] = useState<string[]>([]);
  const schemaRequired = getProviderSettings(selDialect).schemaRequired;

  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [installing, setInstalling] = useState(false);

  const [testingState, setTestingState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'failed';
    error?: string;
  }>({ status: 'idle' });

  useEffect(() => {
    if (open) {
      setSelDialect(dialect);
      setName(sanitizeName(initialName ?? ''));
      setForm({
        host: initialOptions?.host || 'localhost',
        port: initialOptions?.port || defaultPorts[dialect],
        database: initialOptions?.database || '',
        schema: initialOptions?.schema || getProviderSettings(dialect).defaultSchema || '',
        username: initialOptions?.username || '',
        password: initialOptions?.password || '',
        ssl: { enabled: initialOptions?.ssl?.enabled || false },
        pool: { min: initialOptions?.pool?.min || 1, max: initialOptions?.pool?.max || 10 },
      });
      setSchemaList([]);
      setSavePassword(initialHasPassword ?? false);
      setTestingState({ status: 'idle' });
    }
  }, [open, dialect, initialOptions, initialName, initialHasPassword]);

  // Check whether the selected provider's driver is installed, whenever the
  // modal opens or the provider changes. (Must stay above the early return —
  // hooks run unconditionally every render.)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDriverInfo(null);
    apiCheckDriver(selDialect)
      .then((info) => { if (!cancelled) setDriverInfo(info); })
      .catch(() => { if (!cancelled) setDriverInfo(null); });
    return () => { cancelled = true; };
  }, [open, selDialect]);

  if (!open) return null;

  const updateField = (key: keyof ConnectionOptions, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const changeDialect = (d: Dialect) => {
    setSelDialect(d);
    setSchemaList([]); // schemas are provider-specific — clear stale list
    // refresh dialect-specific defaults
    setForm((prev) => ({
      ...prev,
      port: defaultPorts[d],
      schema: getProviderSettings(d).defaultSchema || '',
    }));
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await apiInstallDriver(selDialect);
      setDriverInfo(await apiCheckDriver(selDialect));
    } catch {
      /* leave as not-installed; the server logs the install error */
    } finally {
      setInstalling(false);
    }
  };

  // Connect with the entered params and pull the list of selectable schemas.
  // This doubles as the connection check (there is no separate Test button).
  const loadSchemas = async () => {
    setTestingState({ status: 'testing' });
    try {
      const option: ConnectionOptions = { ...form, connectionString: buildConnectionString(selDialect, form) };
      const list = await fetchSchemaList({ dialect: selDialect, option });
      setSchemaList(list);
      if (list.length && !list.includes(form.schema || '')) {
        // For single-schema-per-database dialects (MySQL/MariaDB), "schema" and
        // "database" are the same concept — prefer the already-entered database
        // name over the first alphabetical entry in the list.
        const preferred = form.database && list.includes(form.database) ? form.database : list[0];
        updateField('schema', preferred);
      }
      setTestingState({ status: 'success' });
    } catch (error: any) {
      setTestingState({ status: 'failed', error: error.message || 'Failed to load schemas' });
    }
  };

  const handleSave = async () => {
    if (schemaRequired && !form.schema?.trim()) {
      setTestingState({ status: 'failed', error: 'Load schemas and pick one before saving.' });
      return;
    }

    const option: ConnectionOptions = {
      ...form,
      schemaRequired,
      connectionString: buildConnectionString(selDialect, form),
    };

    try {
      if (isCredential) {
        // Send the full option (the caller may reuse the typed password for THIS session);
        // the server persists it only when savePassword is true.
        await onSaveCredential?.({
          name: name.trim() || `${form.host}/${form.database}`,
          dialect: selDialect,
          schema: form.schema,
          option,
          savePassword,
        });
      } else {
        onSave?.(option, selDialect);
      }
      onClose();
    } catch (error: any) {
      setTestingState({ status: 'failed', error: error.message || 'Could not save credential' });
    }
  };

  const inputCls = 'mt-1 w-full bg-slate-950 border border-slate-850 focus:border-cyan-500 text-sm text-slate-200 rounded px-3 py-2 outline-none font-mono';
  const labelCls = 'text-[10px] uppercase font-bold text-slate-400 tracking-wider';

  return createPortal(
    <div data-testid="conn-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-[500px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div>
            <h2 className="text-slate-100 font-bold text-base">{isCredential ? (initialName ? 'Edit Credential' : 'Add Credential') : 'Connection Parameters'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isCredential ? 'Saved encrypted and reusable from the connection dropdowns' : `Configure options for ${selDialect.toUpperCase()}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isCredential && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Credential Name</label>
                <input
                  data-testid="conn-name-input"
                  placeholder="e.g. Prod DB2"
                  value={name}
                  onChange={(e) => setName(sanitizeName(e.target.value))}
                  maxLength={MAX_NAME_LEN}
                  className={inputCls.replace('font-mono', '')}
                />
                <p className="text-[10px] text-slate-500 mt-1">Letters, numbers, spaces, - and _ · max {MAX_NAME_LEN}</p>
              </div>
              <div>
                <label className={labelCls}>Dialect</label>
                <select data-testid="conn-dialect-select" value={selDialect} onChange={(e) => changeDialect(e.target.value as Dialect)} className={inputCls}>
                  {dialectOptions.map((d) => (
                    <option key={d.dialect} value={d.dialect}>{d.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {!isCredential && (
            <div>
              <label className={labelCls}>Provider</label>
              <select data-testid="conn-dialect-select" value={selDialect} onChange={(e) => changeDialect(e.target.value as Dialect)} className={inputCls}>
                {dialectOptions.map((d) => (
                  <option key={d.dialect} value={d.dialect}>{d.label}</option>
                ))}
              </select>
            </div>
          )}

          {driverInfo && (
            driverInfo.installed ? (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90 px-0.5">
                <CheckCircle className="w-3.5 h-3.5" />
                Driver ready · {driverInfo.packageName}{driverInfo.version ? ` ${driverInfo.version}` : ''}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/30">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 min-w-0">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Driver "{driverInfo.packageName}" is not installed
                </span>
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  title="Install the driver package on the server"
                  className="shrink-0 text-xs font-bold on-accent-fg bg-amber-400 hover:bg-amber-300 disabled:bg-slate-700 disabled:text-slate-400 px-3 py-1 rounded flex items-center gap-1.5 cursor-pointer disabled:cursor-wait"
                >
                  {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {installing ? 'Installing…' : 'Install'}
                </button>
              </div>
            )
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Host</label>
              <input data-testid="conn-host-input" placeholder="localhost" value={form.host} onChange={(e) => updateField('host', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Port</label>
              <input data-testid="conn-port-input" type="number" placeholder={String(defaultPorts[selDialect])} value={form.port} onChange={(e) => updateField('port', Number(e.target.value))} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Database Name</label>
            <input data-testid="conn-database-input" placeholder="my_database" value={form.database} onChange={(e) => updateField('database', e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input data-testid="conn-username-input" placeholder="user" value={form.username} onChange={(e) => updateField('username', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input data-testid="conn-password-input" type="password" placeholder={isCredential && initialHasPassword && !form.password ? '•••••••• (saved)' : '••••••••'} value={form.password} onChange={(e) => updateField('password', e.target.value)} className={inputCls} />
            </div>
          </div>

          {isCredential && (
            <label className="flex items-center gap-2.5 text-xs text-slate-350 cursor-pointer select-none pt-1">
              <input
                data-testid="conn-save-password"
                type="checkbox"
                checked={savePassword}
                onChange={(e) => setSavePassword(e.target.checked)}
                className="w-4 h-4 rounded border-slate-800 bg-slate-950 text-cyan-600 focus:ring-0 focus:ring-offset-0"
              />
              Save password (encrypted)
              <span className="text-slate-500">— off: you'll enter it each session</span>
            </label>
          )}

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2.5 text-xs text-slate-350 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.ssl?.enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, ssl: { ...prev.ssl, enabled: e.target.checked } }))}
                className="w-4 h-4 rounded border-slate-800 bg-slate-950 text-cyan-600 focus:ring-0 focus:ring-offset-0"
              />
              Enable SSL Connection
            </label>
          </div>

          <div>
            <label className={labelCls}>
              Schema{schemaRequired ? <span className="text-rose-400 ml-1">*</span> : <span className="text-slate-600 ml-1">(optional)</span>}
            </label>
            <div className="flex gap-2 mt-1">
              {schemaList.length > 0 ? (
                <select data-testid="conn-schema-select" value={form.schema} onChange={(e) => updateField('schema', e.target.value)} className={`${inputCls} !mt-0 flex-1`}>
                  {!schemaRequired && <option value="">— all schemas —</option>}
                  {form.schema && !schemaList.includes(form.schema) && <option value={form.schema}>{form.schema}</option>}
                  {schemaList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  data-testid="conn-schema-input"
                  placeholder={schemaRequired ? 'Required — load or type schema name' : 'Optional — leave blank or type a schema name'}
                  value={form.schema}
                  onChange={(e) => updateField('schema', e.target.value)}
                  className={`${inputCls} !mt-0 flex-1`}
                />
              )}
              <button
                data-testid="conn-load-schema-btn"
                onClick={loadSchemas}
                disabled={testingState.status === 'testing'}
                title="Connect and list available schemas"
                className="shrink-0 px-3 rounded text-xs font-bold bg-slate-800 border border-slate-700 hover:border-cyan-500/40 text-cyan-400 transition flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait cursor-pointer"
              >
                {testingState.status === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListTree className="w-3.5 h-3.5" />}
                Load Schema
              </button>
            </div>
          </div>

          {testingState.status !== 'idle' && (
            <div data-testid={`conn-test-${testingState.status}`} className={`mt-3 p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
              testingState.status === 'testing' ? 'bg-slate-950/40 border-slate-800 text-slate-400'
                : testingState.status === 'success' ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-950/20 border-rose-500/20 text-rose-400'
            }`}>
              {testingState.status === 'testing' && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0 mt-0.5" />}
              {testingState.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
              {testingState.status === 'failed' && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
              <div>
                <p className="font-semibold">
                  {testingState.status === 'testing' && 'Loading schemas…'}
                  {testingState.status === 'success' && 'Schemas loaded'}
                  {testingState.status === 'failed' && 'Connection Failed'}
                </p>
                {testingState.error && <p className="mt-1 text-slate-400 font-mono text-[10px] leading-relaxed break-all">{testingState.error}</p>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end items-center gap-2 px-6 py-4 bg-slate-950/60 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-850/50 rounded transition">
            Cancel
          </button>
          <button
            data-testid="conn-save-btn"
            onClick={handleSave}
            disabled={testingState.status === 'testing'}
            className="px-4 py-2 text-xs font-bold accent-grad on-accent-fg rounded transition shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-wait flex items-center gap-1.5"
          >
            {isCredential ? 'Save Credential' : 'Apply & Connect'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
