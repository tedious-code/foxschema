import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { extractTableAliases } from '../../lib/sql-splitter';
import { getCompletionContext } from './sqlEditorBridge';

const LIGHT_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL',
  'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'HAVING', 'UNION',
  'ALL', 'DISTINCT', 'AS', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'WITH', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END',
];

const LANG_IDS = ['sql', 'pgsql', 'mysql'] as const;

let registered = false;

/**
 * Register completion providers once per Monaco language id. Suggestions read
 * the active tab's SQL + schemaCache via {@link getCompletionContext} so we
 * never re-register (duplicate-provider leak) on remount.
 *
 * Alias support: `alias.` / `alias.col…` resolves via {@link extractTableAliases}
 * to the underlying table's columns. Aliases themselves are also suggested.
 */
export function ensureSqlCompletions(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  const provider: Monaco.languages.CompletionItemProvider = {
    triggerCharacters: ['.', '{'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const { sql, schemas, variables } = getCompletionContext();
      // Prefer the live model text — context sql can lag one keystroke behind.
      const aliases = extractTableAliases(model.getValue() || sql);
      const tableIndex = buildTableIndex(schemas);
      const prefix = (word.word || '').toLowerCase();

      // `${{name.` — suggest columns of a table variable.
      const varColMatch = /\$\{\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(
        linePrefix
      );
      if (varColMatch) {
        const varName = varColMatch[1]!;
        const partial = (varColMatch[2] ?? '').toLowerCase();
        const startCol = position.column - (varColMatch[2]?.length ?? 0);
        const colRange: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: startCol,
          endColumn: position.column,
        };
        const tableVar = variables.find(
          (v) => v.name === varName && v.kind === 'table'
        );
        if (!tableVar) {
          return {
            suggestions: [
              {
                label: `(${varName} is not a table variable)`,
                kind: monaco.languages.CompletionItemKind.Text,
                insertText: '',
                detail: 'Save a result as table, or use -- @set name = table',
                range: colRange,
              },
            ],
          };
        }
        const cols = (tableVar.columns ?? []).filter(
          (c) => !partial || c.toLowerCase().startsWith(partial)
        );
        return {
          suggestions: cols.map((c) => ({
            label: c,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: `${c}}}`,
            detail: `column · ${varName}`,
            sortText: `0_${c}`,
            range: colRange,
          })),
        };
      }

      // `${{` or `${{partial` — suggest global SQL Editor variables.
      const varMatch = /\$\{\{([A-Za-z_][A-Za-z0-9_]*)?$/.exec(linePrefix);
      if (varMatch) {
        const partial = (varMatch[1] ?? '').toLowerCase();
        const startCol = position.column - (varMatch[1]?.length ?? 0);
        const varRange: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: startCol,
          endColumn: position.column,
        };
        const suggestions = variables
          .filter((v) => !partial || v.name.toLowerCase().startsWith(partial))
          .map((v) => ({
            label: v.name,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: `${v.name}}}`,
            detail:
              v.kind === 'list'
                ? `list · ${v.values?.length ?? 0} values`
                : v.kind === 'table'
                  ? `table · ${(v.rows?.length ?? 0)}×${(v.columns?.length ?? 0)}`
                  : 'scalar',
            sortText: `0_${v.name}`,
            range: varRange,
          }));
        if (suggestions.length === 0) {
          return {
            suggestions: [
              {
                label: '(no variables)',
                kind: monaco.languages.CompletionItemKind.Text,
                insertText: '',
                detail: 'Add one in the Variables sidebar or save a result cell',
                range: varRange,
              },
            ],
          };
        }
        return { suggestions };
      }

      // `alias.` or `alias.partial` — keep matching after the user types past the dot.
      const dot = /([A-Za-z_][\w$]*)\.([A-Za-z_\d$]*)$/.exec(linePrefix);
      if (dot) {
        const ref = dot[1]!.toLowerCase();
        const partial = (dot[2] ?? '').toLowerCase();
        const tableName = aliases[ref] ?? ref;
        const cols = columnsForTable(tableIndex, tableName).filter(
          (name) => !partial || name.toLowerCase().startsWith(partial)
        );
        // Replace only the column fragment after the dot (not the alias).
        const colRange: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - partial.length,
          endColumn: position.column,
        };
        if (cols.length === 0 && aliases[ref]) {
          // Alias resolved but schema has no columns yet — surface why.
          return {
            suggestions: [
              {
                label: `(no columns for ${tableName})`,
                kind: monaco.languages.CompletionItemKind.Text,
                insertText: '',
                detail: schemas.length === 0
                  ? 'Load a destination schema (check a server)'
                  : 'Table not in loaded schema',
                range: colRange,
              },
            ],
          };
        }
        return {
          suggestions: cols.map((name) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: name,
            detail: `column · ${tableName}`,
            range: colRange,
          })),
        };
      }

      const seen = new Set<string>();
      const suggestions: Monaco.languages.CompletionItem[] = [];

      // Aliases first so `u` suggests the alias before unrelated keywords.
      for (const [alias, table] of Object.entries(aliases)) {
        if (alias === table.toLowerCase()) continue; // skip bare table self-map
        if (table.toLowerCase().endsWith('.' + alias)) continue;
        const bare = table.toLowerCase().includes('.')
          ? table.toLowerCase().slice(table.toLowerCase().lastIndexOf('.') + 1)
          : table.toLowerCase();
        if (alias === bare) continue;
        if (prefix && !alias.startsWith(prefix)) continue;
        if (seen.has(alias)) continue;
        seen.add(alias);
        suggestions.push({
          label: alias,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: alias,
          detail: `alias → ${table}`,
          sortText: `0_${alias}`,
          range,
        });
      }

      for (const src of schemas) {
        for (const t of src.tables) {
          if (t.objectType !== 'TABLE' && t.objectType !== 'VIEW' && t.objectType !== 'MQT') continue;
          const key = t.name.toLowerCase();
          const bare = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
          if (prefix && !key.startsWith(prefix) && !bare.startsWith(prefix)) continue;
          if (seen.has(key) || seen.has(bare)) continue;
          seen.add(key);
          seen.add(bare);
          suggestions.push({
            label: t.name,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: t.name,
            detail: t.objectType.toLowerCase(),
            sortText: `1_${t.name}`,
            range,
          });
        }
      }

      for (const kw of LIGHT_KEYWORDS) {
        const low = kw.toLowerCase();
        if (seen.has(low)) continue;
        if (prefix && !low.startsWith(prefix)) continue;
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          detail: 'keyword',
          sortText: `2_${kw}`,
          range,
        });
      }

      return { suggestions };
    },
  };

  for (const lang of LANG_IDS) {
    monaco.languages.registerCompletionItemProvider(lang, provider);
  }
}

type TableIndex = Map<string, Set<string>>; // lower table name → column names

function buildTableIndex(schemas: ReturnType<typeof getCompletionContext>['schemas']): TableIndex {
  const index: TableIndex = new Map();
  for (const src of schemas) {
    for (const t of src.tables) {
      if (t.objectType !== 'TABLE' && t.objectType !== 'VIEW' && t.objectType !== 'MQT') continue;
      const cols = new Set<string>((t.columns ?? []).map((c: { name: string }) => c.name));
      const full = t.name;
      const lower = full.toLowerCase();
      const bare = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
      mergeCols(index, lower, cols);
      mergeCols(index, bare, cols);
    }
  }
  return index;
}

function mergeCols(index: TableIndex, key: string, cols: Set<string>): void {
  const existing = index.get(key);
  if (!existing) {
    index.set(key, new Set(cols));
    return;
  }
  for (const c of cols) existing.add(c);
}

function columnsForTable(index: TableIndex, tableName: string): string[] {
  const lower = tableName.toLowerCase();
  const bare = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
  let set = index.get(lower) ?? index.get(bare);
  if (!set) {
    // Schema may store SCHEMA.TABLE while the SQL used a bare/keyword table name.
    for (const [key, cols] of index) {
      if (key === bare || key.endsWith('.' + bare)) {
        set = cols;
        break;
      }
    }
  }
  if (!set) return [];
  return [...set].sort((a, b) => a.localeCompare(b));
}
