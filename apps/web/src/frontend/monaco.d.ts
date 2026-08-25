// monaco-editor's deep ESM subpaths aren't mapped in its type exports; declare them.
declare module 'monaco-editor/editor/editor.api' {
  export * from 'monaco-editor';
}
declare module 'monaco-editor/languages/definitions/sql/register';
declare module 'monaco-editor/languages/definitions/pgsql/register';
declare module 'monaco-editor/languages/definitions/mysql/register';
declare module 'monaco-editor/languages/definitions/javascript/register';
declare module 'monaco-editor/languages/definitions/typescript/register';
declare module 'monaco-editor/languages/definitions/sql/sql' {
  import type { languages } from 'monaco-editor';
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}
