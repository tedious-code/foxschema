import React from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { MONACO_THEME, monacoLanguage } from '../monaco-setup';

const BASE_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineNumbersMinChars: 3,
  renderLineHighlight: 'none' as const,
  scrollbar: { alwaysConsumeMouseWheel: false },
  padding: { top: 8, bottom: 8 },
  // Watch the container size — without this the editor renders blank inside flex layouts
  automaticLayout: true,
};

interface SqlViewerProps {
  value: string;
  dialect: string;
  /** When false (default) the editor is read-only. */
  editable?: boolean;
  onChange?: (value: string) => void;
  height?: string | number;
}

/** Single-pane SQL editor/viewer backed by Monaco. */
export const SqlEditor: React.FC<SqlViewerProps> = ({ value, dialect, editable = false, onChange, height = '100%' }) => (
  <Editor
    height={height}
    theme={MONACO_THEME}
    language={monacoLanguage(dialect)}
    value={value}
    onChange={(v) => onChange?.(v ?? '')}
    options={{ ...BASE_OPTIONS, readOnly: !editable, domReadOnly: !editable }}
  />
);

interface SqlDiffProps {
  /** Left side — the target (destination) DDL. */
  original: string;
  /** Right side — the source DDL. */
  modified: string;
  dialect: string;
  inline?: boolean;
  ignoreCase?: boolean;
  height?: string | number;
}

/** Side-by-side (or inline) SQL diff backed by Monaco's DiffEditor. */
export const SqlDiffEditor: React.FC<SqlDiffProps> = ({ original, modified, dialect, inline = false, ignoreCase = false, height = '100%' }) => {
  // Monaco's diff is case-sensitive; normalize both sides to collapse case-only differences
  const orig = ignoreCase ? original.toUpperCase() : original;
  const mod = ignoreCase ? modified.toUpperCase() : modified;

  return (
    <DiffEditor
      height={height}
      theme={MONACO_THEME}
      language={monacoLanguage(dialect)}
      original={orig}
      modified={mod}
      options={{
        ...BASE_OPTIONS,
        readOnly: true,
        renderSideBySide: !inline,
        ignoreTrimWhitespace: false,
        renderOverviewRuler: false,
        diffWordWrap: 'off',
        diffAlgorithm: 'advanced',
      }}
    />
  );
};
