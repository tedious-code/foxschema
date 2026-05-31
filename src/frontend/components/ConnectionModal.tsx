import React, { useState } from "react";
import { X } from "lucide-react";
import { ConnectionOptions } from "../../backend/interfaces/schema-provider.interface";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (options: ConnectionOptions) => void;
}

export const ConnectionModal: React.FC<Props> = ({
  open,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<ConnectionOptions>({
    host: 'localhost',
    port: 5432,
    database: '',
    username: '',
    password: '',
    ssl: {
      enabled: false,
    },
    pool: {
      min: 1,
      max: 10,
    },
  });

  if (!open) return null;

  const updateField = (key: keyof ConnectionOptions, value: any) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = () => {
    const connectionString =
      `postgresql://${encodeURIComponent(form.username || '')}` +
      `:${encodeURIComponent(form.password || '')}` +
      `@${form.host}:${form.port}/${form.database}`;

    onSave({
      ...form,
      connectionString,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="w-[600px] bg-slate-900 border border-slate-700 rounded-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">
            Add Database Connection
          </h2>

          <button onClick={onClose}>
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            placeholder="Host"
            value={form.host}
            onChange={(e) => updateField('host', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
          />

          <input
            type="number"
            placeholder="Port"
            value={form.port}
            onChange={(e) =>
              updateField('port', Number(e.target.value))
            }
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
          />

          <input
            placeholder="Database"
            value={form.database}
            onChange={(e) =>
              updateField('database', e.target.value)
            }
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
          />

          <input
            placeholder="Username"
            value={form.username}
            onChange={(e) =>
              updateField('username', e.target.value)
            }
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
          />

          <input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) =>
              updateField('password', e.target.value)
            }
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
          />

          <label className="flex items-center gap-2 text-sm text-slate-300">
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
            />
            Enable SSL
          </label>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 rounded"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};