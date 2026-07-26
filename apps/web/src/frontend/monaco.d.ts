// monaco-editor's deep ESM subpaths aren't mapped in its type exports; declare them.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor';
}
declare module 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/sql/sql' {
  import type { languages } from 'monaco-editor';
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}
