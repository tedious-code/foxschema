/**
 * Checkbox list of alias.column when the user clicks SELECT / FROM in the editor.
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns3, X } from 'lucide-react';
import { extractTableAliases } from '../../lib/sql-splitter';
import { insertIntoSelectList } from '../../lib/selectClauseEdit';
import { getCompletionContext, mutateSql } from './sqlEditorBridge';
import { SQL_ICON_STROKE } from './sqlIconStyle';

export type SelectColumnPickerAnchor = {
  top: number;
  left: number;
};

interface Props {
  open: boolean;
  anchor: SelectColumnPickerAnchor | null;
  onClose: () => void;
}

type ColOpt = { key: string; label: string; expr: string };

export const SelectColumnPicker: React.FC<Props> = ({ open, anchor, onClose }) => {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const options = useMemo(() => {
    if (!open) return [] as ColOpt[];
    const ctx = getCompletionContext();
    const aliases = extractTableAliases(ctx.sql);
    // Prefer shorter aliases over fully-qualified table keys.
    const aliasToTable = new Map<string, string>();
    for (const [alias, table] of Object.entries(aliases)) {
      const prev = aliasToTable.get(table.toLowerCase());
      if (!prev || alias.length < prev.length) aliasToTable.set(table.toLowerCase(), alias);
    }
    const out: ColOpt[] = [];
    const seen = new Set<string>();
    for (const schema of ctx.schemas) {
      for (const table of schema.tables ?? []) {
        if (table.objectType !== 'TABLE' && table.objectType !== 'VIEW' && table.objectType !== 'MQT') {
          continue;
        }
        const bare = table.name.includes('.')
          ? table.name.slice(table.name.lastIndexOf('.') + 1)
          : table.name;
        const alias =
          aliasToTable.get(table.name.toLowerCase()) ||
          aliasToTable.get(bare.toLowerCase()) ||
          bare;
        // Only list tables referenced in the query (or all when FROM was empty).
        const referenced = Object.keys(aliases).length === 0 || aliases[alias.toLowerCase()] || aliases[bare.toLowerCase()] || aliases[table.name.toLowerCase()];
        if (!referenced) continue;
        for (const col of table.columns ?? []) {
          const expr = `${alias}.${col.name}`;
          const key = expr.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ key, label: expr, expr });
        }
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [open]);

  if (!open || !anchor) return null;

  const visible = options.filter((o) => !hidden.has(o.key));

  return createPortal(
    <div
      data-testid="sql-select-column-picker"
      className="fixed z-[120] w-72 max-h-80 flex flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
      style={{ top: Math.min(anchor.top, window.innerHeight - 340), left: Math.min(anchor.left, window.innerWidth - 300) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-800 shrink-0">
        <Columns3 className="w-3.5 h-3.5 text-cyan-400" strokeWidth={SQL_ICON_STROKE} />
        <span className="text-[11px] font-bold text-slate-200 flex-1">SELECT columns</span>
        {hidden.size > 0 && (
          <button
            type="button"
            data-testid="sql-select-column-show-all"
            className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
            onClick={() => setHidden(new Set())}
          >
            Show all
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="p-0.5 text-slate-500 hover:text-slate-200"
        >
          <X className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
        </button>
      </div>
      <ul className="overflow-y-auto flex-1 min-h-0 px-1 py-1">
        {options.length === 0 ? (
          <li className="px-2 py-3 text-[11px] text-slate-500">
            No columns found — load Schema and add tables in FROM.
          </li>
        ) : (
          options.map((opt) => {
            const checked = !hidden.has(opt.key);
            return (
              <li key={opt.key}>
                <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800/70 cursor-pointer text-[11px] font-mono text-slate-200">
                  <input
                    type="checkbox"
                    checked={checked}
                    data-testid={`sql-select-col-${opt.key}`}
                    onChange={() => {
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(opt.key)) next.delete(opt.key);
                        else next.add(opt.key);
                        return next;
                      });
                      if (!checked) {
                        // turning on — add into SELECT
                        mutateSql((sql) => insertIntoSelectList(sql, opt.expr));
                      }
                    }}
                    className="accent-cyan-500"
                  />
                  <span className={checked ? '' : 'text-slate-600 line-through'}>{opt.label}</span>
                </label>
              </li>
            );
          })
        )}
      </ul>
      <div className="px-2 py-1.5 border-t border-slate-800 text-[10px] text-slate-500 shrink-0">
        {visible.length}/{options.length} shown · click SELECT/FROM again to reopen
      </div>
    </div>,
    document.body
  );
};
