// Self-host Monaco from the bundled package instead of the default CDN loader,
// so the editor works in offline / firewalled enterprise networks.
import { loader } from '@monaco-editor/react';
// Import only the editor core + the SQL dialects we use, not all ~90 languages
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution';
import 'monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// SQL highlighting runs on the main thread (basic-languages); only the core
// editor worker is needed for edit operations, diffing, etc.
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

loader.config({ monaco });

/** Shared dark theme tuned to the app's slate palette. */
export const MONACO_THEME = 'schemaSyncDark';

monaco.editor.defineTheme(MONACO_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#020617',
    'editor.foreground': '#cbd5e1',
    'editorCursor.foreground': '#22d3ee',
    'editor.lineHighlightBackground': '#0f172a',
    'editorLineNumber.foreground': '#334155',
    'editorGutter.background': '#020617',
    'diffEditor.insertedTextBackground': '#10b98122',
    'diffEditor.removedTextBackground': '#f43f5e22',
    'diffEditor.insertedLineBackground': '#10b98118',
    'diffEditor.removedLineBackground': '#f43f5e18',
  },
});

/** Map an app dialect to a Monaco language id. */
export function monacoLanguage(dialect: string): string {
  switch (dialect.toLowerCase()) {
    case 'mysql':
      return 'mysql';
    case 'postgres':
      return 'pgsql';
    default:
      return 'sql';
  }
}
