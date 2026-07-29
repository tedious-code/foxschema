/**
 * FoxScript SQL semantic tokens — highlight table / column names from the
 * schema cache when they appear in SQL blocks (not inside code fences).
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { SchemaCacheEntry } from '../components/sql-editor/sqlEditorBridge';
import { FOXSCRIPT_LANG, FOXSCHEMA_SQL_LANG } from './foxschemaSqlLanguage';
import { parseFoxScript } from './sql-splitter';

const LEGEND_TYPES = ['type', 'property'] as const;

function collectNames(schemaCache: Record<string, SchemaCacheEntry>): {
  tables: Set<string>;
  columns: Set<string>;
} {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const entry of Object.values(schemaCache)) {
    for (const t of entry.tables ?? []) {
      if (t.name) tables.add(t.name.toLowerCase());
      const bare = t.name?.includes('.') ? t.name.split('.').pop()! : t.name;
      if (bare) tables.add(bare.toLowerCase());
      for (const c of t.columns ?? []) {
        if (c.name) columns.add(c.name.toLowerCase());
      }
    }
  }
  return { tables, columns };
}

let registered = false;
let changeListeners: Array<() => void> = [];

/** Call when schemaCache updates so SQL identifiers re-tokenise. */
export function refreshFoxscriptSemanticTokens(): void {
  for (const fn of [...changeListeners]) fn();
}

/**
 * Register a DocumentSemanticTokensProvider for FoxScript SQL blocks.
 * `getSchemaCache` is read live so tokens refresh when schemas load.
 */
export function ensureFoxscriptSemanticTokens(
  monaco: typeof Monaco,
  getSchemaCache: () => Record<string, SchemaCacheEntry>
): void {
  if (registered) return;
  registered = true;

  const legend: Monaco.languages.SemanticTokensLegend = {
    tokenTypes: [...LEGEND_TYPES],
    tokenModifiers: [],
  };

  const onDidChange: Monaco.IEvent<void> = (listener) => {
    const wrap = () => listener(undefined);
    changeListeners.push(wrap);
    return {
      dispose: () => {
        changeListeners = changeListeners.filter((l) => l !== wrap);
      },
    };
  };

  const provider: Monaco.languages.DocumentSemanticTokensProvider = {
    onDidChange,
    getLegend: () => legend,
    releaseDocumentSemanticTokens: () => undefined,
    provideDocumentSemanticTokens(model) {
      const lang = model.getLanguageId();
      if (lang !== FOXSCRIPT_LANG && lang !== FOXSCHEMA_SQL_LANG) {
        return { data: new Uint32Array() };
      }
      const { tables, columns } = collectNames(getSchemaCache());
      if (tables.size === 0 && columns.size === 0) {
        return { data: new Uint32Array() };
      }

      const doc = parseFoxScript(model.getValue());
      const builder: number[] = [];
      let prevLine = 0;
      let prevChar = 0;

      const pushToken = (line: number, char: number, length: number, typeIdx: number) => {
        const deltaLine = line - prevLine;
        const deltaChar = deltaLine === 0 ? char - prevChar : char;
        builder.push(deltaLine, deltaChar, length, typeIdx, 0);
        prevLine = line;
        prevChar = char;
      };

      for (const block of doc.blocks) {
        if (block.type !== 'sql') continue;
        const startLine = block.range.startLine;
        const endLine = block.range.endLine;
        for (let line = startLine; line <= endLine; line++) {
          const text = model.getLineContent(line);
          const re = /[A-Za-z_][A-Za-z0-9_]*/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text))) {
            const word = m[0];
            const lower = word.toLowerCase();
            let typeIdx = -1;
            if (tables.has(lower)) typeIdx = 0; // type → table
            else if (columns.has(lower)) typeIdx = 1; // property → column
            if (typeIdx < 0) continue;
            pushToken(line, m.index + 1, word.length, typeIdx);
          }
        }
      }

      return { data: new Uint32Array(builder) };
    },
  };

  for (const language of [FOXSCRIPT_LANG, FOXSCHEMA_SQL_LANG]) {
    monaco.languages.registerDocumentSemanticTokensProvider(language, provider);
  }
}
