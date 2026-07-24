import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { expandVariableRef, type SqlVariable } from '../../lib/sql-variables';

/** Leftover language HoverProviders from older builds (HMR) — dispose once. */
const DISPOSE_KEY = '__foxschemaSqlVariableHoverDisposables';

// eslint-disable-next-line security/detect-unsafe-regex -- false positive: fixed `${{` prefix; bounded identifier classes
const VAR_AT = /\$\{\{([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\}\}/g;

type Disposable = { dispose: () => void };

/** Clear any stacked language hover providers from prior registrations. */
export function disposeLegacyVariableHovers(): void {
  const g = globalThis as typeof globalThis & { [DISPOSE_KEY]?: Disposable[] };
  const prev = g[DISPOSE_KEY];
  if (!prev?.length) return;
  for (const d of prev) {
    try {
      d.dispose();
    } catch {
      /* ignore */
    }
  }
  g[DISPOSE_KEY] = [];
}

export type VarHoverDecoration = {
  range: Monaco.IRange;
  options: {
    hoverMessage: Monaco.IMarkdownString;
    inlineClassName?: string;
  };
};

function hoverText(variable: SqlVariable | undefined, name: string, column?: string): string {
  if (!variable) return `undefined: ${name}`;
  if (variable.secret) return '(secret)';
  if (variable.kind === 'table' && !column) {
    const r = variable.rows?.length ?? 0;
    const c = variable.columns?.length ?? 0;
    return `${r}×${c} table`;
  }
  const lit = expandVariableRef(variable, column);
  return lit.ok ? lit.sql : lit.error;
}

/**
 * Decorations for `${{name}}` / `${{name.col}}` — hover shows value / table size.
 */
export function buildVariableHoverDecorations(
  monaco: typeof Monaco,
  text: string,
  variables: SqlVariable[]
): VarHoverDecoration[] {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const out: VarHoverDecoration[] = [];
  const lines = text.split(/\n/);

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]!;
    VAR_AT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_AT.exec(line)) !== null) {
      const name = m[1]!;
      const column = m[2];
      const startColumn = m.index + 1;
      const endColumn = m.index + m[0].length + 1;
      out.push({
        range: new monaco.Range(lineNo + 1, startColumn, lineNo + 1, endColumn),
        options: {
          hoverMessage: { value: hoverText(byName.get(name), name, column) },
          inlineClassName: 'fox-sql-var-ref',
        },
      });
    }
  }
  return out;
}
