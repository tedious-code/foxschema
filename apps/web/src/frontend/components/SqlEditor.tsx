import React, { useRef, useEffect, useCallback } from 'react';
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

/**
 * Highlight every (case-insensitive) occurrence of `term` in a Monaco editor,
 * reusing/replacing the previous decorations collection. Mirrors the search
 * highlight in the object browser so a matched keyword is visible in the SQL.
 */
function decorate(editor: any, term: string, prev: any): any {
  prev?.clear?.();
  const model = editor?.getModel?.();
  if (!model || !term.trim()) return null;
  const matches = model.findMatches(term, true, false, false, null, false);
  if (!matches.length) return null;
  return editor.createDecorationsCollection(
    matches.map((m: any) => ({ range: m.range, options: { inlineClassName: 'fox-search-hl' } }))
  );
}

interface SqlViewerProps {
  value: string;
  dialect: string;
  /** When false (default) the editor is read-only. */
  editable?: boolean;
  onChange?: (value: string) => void;
  height?: string | number;
  /** Highlight occurrences of this term (the object-browser search keyword). */
  highlight?: string;
}

/** Single-pane SQL editor/viewer backed by Monaco. */
export const SqlEditor: React.FC<SqlViewerProps> = ({ value, dialect, editable = false, onChange, height = '100%', highlight }) => {
  const editorRef = useRef<any>(null);
  const decoRef = useRef<any>(null);

  const apply = useCallback(() => {
    if (editorRef.current) decoRef.current = decorate(editorRef.current, highlight ?? '', decoRef.current);
  }, [highlight]);

  useEffect(() => {
    apply();
  }, [apply, value]);

  return (
    <Editor
      height={height}
      theme={MONACO_THEME}
      language={monacoLanguage(dialect)}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={(editor) => {
        editorRef.current = editor;
        apply();
      }}
      options={{ ...BASE_OPTIONS, readOnly: !editable, domReadOnly: !editable }}
    />
  );
};

interface SqlDiffProps {
  /** Left side (the diff "original"). */
  original: string;
  /** Right side (the diff "modified"). */
  modified: string;
  dialect: string;
  inline?: boolean;
  ignoreCase?: boolean;
  height?: string | number;
  /** Highlight occurrences of this term on both sides of the diff. */
  highlight?: string;
}

/** Side-by-side (or inline) SQL diff backed by Monaco's DiffEditor. */
export const SqlDiffEditor: React.FC<SqlDiffProps> = ({ original, modified, dialect, inline = false, ignoreCase = false, height = '100%', highlight }) => {
  // Monaco's diff is case-sensitive; normalize both sides to collapse case-only differences
  const orig = ignoreCase ? original.toUpperCase() : original;
  const mod = ignoreCase ? modified.toUpperCase() : modified;

  const diffRef = useRef<any>(null);
  const decoModRef = useRef<any>(null);
  const decoOrigRef = useRef<any>(null);

  const apply = useCallback(() => {
    const diff = diffRef.current;
    if (!diff) return;
    decoModRef.current = decorate(diff.getModifiedEditor(), highlight ?? '', decoModRef.current);
    decoOrigRef.current = decorate(diff.getOriginalEditor(), highlight ?? '', decoOrigRef.current);
  }, [highlight]);

  useEffect(() => {
    apply();
  }, [apply, orig, mod]);

  return (
    <DiffEditor
      height={height}
      theme={MONACO_THEME}
      language={monacoLanguage(dialect)}
      original={orig}
      modified={mod}
      onMount={(editor) => {
        diffRef.current = editor;
        apply();
      }}
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
