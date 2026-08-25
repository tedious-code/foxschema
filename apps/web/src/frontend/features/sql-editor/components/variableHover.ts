import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { expandVariableRef, type SqlVariable } from '@/shared/lib/sql-variables';

// eslint-disable-next-line security/detect-unsafe-regex -- false positive: fixed `${{` prefix; bounded identifier classes
const VAR_AT = /\$\{\{([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\}\}/g;

export type VarHoverDecoration = {
  range: Monaco.IRange;
  options: {
    hoverMessage: Monaco.IMarkdownString;
    inlineClassName?: string;
    inlineClassNameAffectsLetterSpacing?: boolean;
  };
};

function refClassName(variable: SqlVariable | undefined): string {
  if (!variable) return 'fox-sql-var-ref fox-sql-var-ref-missing';
  if (variable.secret) return 'fox-sql-var-ref fox-sql-var-ref-secret';
  return 'fox-sql-var-ref fox-sql-var-ref-ok';
}

function hoverText(variable: SqlVariable | undefined, name: string, column?: string): string {
  if (!variable) return `undefined: ${name}`;
  if (variable.secret) return `**secret** \`${name}\` — value hidden`;
  if (variable.kind === 'table' && !column) {
    const r = variable.rows?.length ?? 0;
    const c = variable.columns?.length ?? 0;
    return `${r}×${c} table`;
  }
  const lit = expandVariableRef(variable, column);
  return lit.ok ? lit.sql : lit.error;
}

/**
 * Decorations for `${{name}}` / `${{name.col}}` — tinted as one syntax unit
 * (overrides Monaco SQL token colors on `$` / `{` / `}`) with hover value.
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
      const variable = byName.get(name);
      const startColumn = m.index + 1;
      const endColumn = m.index + m[0].length + 1;
      out.push({
        range: new monaco.Range(lineNo + 1, startColumn, lineNo + 1, endColumn),
        options: {
          hoverMessage: { value: hoverText(variable, name, column), isTrusted: true },
          inlineClassName: refClassName(variable),
          inlineClassNameAffectsLetterSpacing: true,
        },
      });
    }
  }
  return out;
}
