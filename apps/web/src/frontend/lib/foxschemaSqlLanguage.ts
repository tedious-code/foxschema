import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

/** Monaco language id for the SQL Editor (SQL + embedded JS/TS code cells). */
export const FOXSCHEMA_SQL_LANG = 'foxschema-sql';

const FLAG = '__foxschemaSqlLanguageRegistered';

type MonarchLang = Monaco.languages.IMonarchLanguage;

const FENCE_END_RULE: Monaco.languages.IMonarchLanguageRule = [
  // String form + `@@` so Monarch treats `@` as literal (not an attribute ref).
  '^[ \\t]*--[ \\t]*@@end[ \\t]*$',
  { token: 'comment.fence', next: '@pop', nextEmbedded: '@pop' },
];

const EMBEDDED_BODY: Monaco.languages.IMonarchLanguageRule[] = [
  FENCE_END_RULE,
  [/.*$/, ''],
];

/**
 * Register `foxschema-sql`: base SQL highlighting with JavaScript/TypeScript
 * embedded inside `-- @js` / `-- @ts` / `-- @node` / `-- @nodets` … `-- @end`.
 * Loads JS/TS language packs lazily so a hard refresh does not pull them into
 * the critical Monaco startup path.
 */
export async function ensureFoxschemaSqlLanguage(
  monaco: typeof Monaco
): Promise<boolean> {
  const g = monaco as typeof Monaco & { [FLAG]?: boolean };
  if (g[FLAG]) return true;

  try {
    await Promise.all([
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'),
      import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'),
    ]);
    const { conf: sqlConf, language: sqlLanguage } = await import(
      'monaco-editor/esm/vs/basic-languages/sql/sql'
    );

    monaco.languages.register({
      id: FOXSCHEMA_SQL_LANG,
      aliases: ['FoxSchema SQL'],
    });
    monaco.languages.setLanguageConfiguration(FOXSCHEMA_SQL_LANG, sqlConf);

    const base = sqlLanguage as MonarchLang;
    const tokenizer = { ...(base.tokenizer ?? {}) } as MonarchLang['tokenizer'] &
      Record<string, Monaco.languages.IMonarchLanguageRule[]>;
    const root = [...(tokenizer.root ?? [])];

    monaco.languages.setMonarchTokensProvider(FOXSCHEMA_SQL_LANG, {
      ...base,
      tokenizer: {
        ...tokenizer,
        root: [
          [
            '^[ \\t]*--[ \\t]*@@(?:node-typescript|node-ts|nodets|typescript|ts)[ \\t]*$',
            {
              token: 'comment.fence',
              next: '@tsEmbedded',
              nextEmbedded: 'text/typescript',
            },
          ],
          [
            '^[ \\t]*--[ \\t]*@@(?:javascript|js|node)[ \\t]*$',
            {
              token: 'comment.fence',
              next: '@jsEmbedded',
              nextEmbedded: 'text/javascript',
            },
          ],
          ...root,
        ],
        jsEmbedded: EMBEDDED_BODY,
        tsEmbedded: EMBEDDED_BODY,
      },
    });

    g[FLAG] = true;
    return true;
  } catch (err) {
    console.warn('[foxschema-sql] code-cell highlighting unavailable', err);
    return false;
  }
}
