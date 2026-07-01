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

/** Diff highlight color per object status — same hue for inserted/removed regions,
 * since a diff pane's "add" vs "remove" is relative to which side you're reading,
 * not a fixed direction. The color instead signals what the migration will DO:
 * green = brand-new object, amber = an existing object's definition changed,
 * red = the object is being dropped. */
const DIFF_HUE: Record<'ADDED' | 'MODIFIED' | 'REMOVED', string> = {
  ADDED: '#22c55e',    // green-500
  MODIFIED: '#f59e0b', // amber-500
  REMOVED: '#ef4444',  // red-500
};

function diffColors(hex: string, dark: boolean) {
  return {
    'diffEditor.insertedTextBackground': `${hex}${dark ? '22' : '2e'}`,
    'diffEditor.removedTextBackground': `${hex}${dark ? '22' : '2e'}`,
    'diffEditor.insertedLineBackground': `${hex}${dark ? '18' : '22'}`,
    'diffEditor.removedLineBackground': `${hex}${dark ? '18' : '22'}`,
  };
}

const BASE_DARK_COLORS = {
  'editor.background': '#020617',
  'editor.foreground': '#cbd5e1',
  'editorCursor.foreground': '#22d3ee',
  'editor.lineHighlightBackground': '#0f172a',
  'editorLineNumber.foreground': '#334155',
  'editorGutter.background': '#020617',
};

const BASE_LIGHT_COLORS = {
  'editor.background': '#ffffff',
  'editor.foreground': '#1e293b',
  'editorCursor.foreground': '#0891b2',
  'editor.lineHighlightBackground': '#f1f5f9',
  'editorLineNumber.foreground': '#94a3b8',
  'editorGutter.background': '#ffffff',
};

/** Shared dark theme tuned to the app's slate palette — default/MODIFIED variant. */
export const MONACO_THEME = 'schemaSyncDark';
/** Light counterpart, used when the app theme resolves to light. */
export const MONACO_THEME_LIGHT = 'schemaSyncLight';

monaco.editor.defineTheme(MONACO_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { ...BASE_DARK_COLORS, ...diffColors(DIFF_HUE.MODIFIED, true) },
});

monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { ...BASE_LIGHT_COLORS, ...diffColors(DIFF_HUE.MODIFIED, false) },
});

/** Status-specific diff themes — one per object status, dark + light. */
export const MONACO_DIFF_THEME: Record<'ADDED' | 'MODIFIED' | 'REMOVED', string> = {
  ADDED: 'schemaSyncDiffAddedDark',
  MODIFIED: MONACO_THEME,
  REMOVED: 'schemaSyncDiffRemovedDark',
};

export const MONACO_DIFF_THEME_LIGHT: Record<'ADDED' | 'MODIFIED' | 'REMOVED', string> = {
  ADDED: 'schemaSyncDiffAddedLight',
  MODIFIED: MONACO_THEME_LIGHT,
  REMOVED: 'schemaSyncDiffRemovedLight',
};

monaco.editor.defineTheme(MONACO_DIFF_THEME.ADDED, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { ...BASE_DARK_COLORS, ...diffColors(DIFF_HUE.ADDED, true) },
});
monaco.editor.defineTheme(MONACO_DIFF_THEME_LIGHT.ADDED, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { ...BASE_LIGHT_COLORS, ...diffColors(DIFF_HUE.ADDED, false) },
});
monaco.editor.defineTheme(MONACO_DIFF_THEME.REMOVED, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { ...BASE_DARK_COLORS, ...diffColors(DIFF_HUE.REMOVED, true) },
});
monaco.editor.defineTheme(MONACO_DIFF_THEME_LIGHT.REMOVED, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { ...BASE_LIGHT_COLORS, ...diffColors(DIFF_HUE.REMOVED, false) },
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
