import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { MONACO_THEME, MONACO_THEME_LIGHT, monacoLanguage } from '../../monaco-setup';
import { useUiStore } from '../../store/uiStore';
import { splitSqlStatements, checkStatement } from '../../lib/sql-splitter';
import { ensureSqlCompletions } from './completion';
import { setSqlInsertHandler } from './sqlEditorBridge';

// Mirrors SqlEditor.tsx's BASE_OPTIONS (that component stays read-only-oriented;
// this one is the editable editor with a glyph margin for statement status icons).
const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineNumbersMinChars: 3,
  renderLineHighlight: 'line' as const,
  scrollbar: { alwaysConsumeMouseWheel: false },
  padding: { top: 8, bottom: 8 },
  automaticLayout: true,
  glyphMargin: true,
  tabSize: 2,
  // Schema-aware suggestions from completion.ts (tables / columns / keywords).
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
};

export interface RevealRequest {
  startLine: number;
  endLine: number;
  /** Bump to re-trigger reveal for the same range. */
  nonce: number;
}

interface Props {
  value: string;
  dialect: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter shortcut → run. */
  onRun?: () => void;
  /** Statement strip click → scroll/select that range. */
  reveal?: RevealRequest | null;
}

/**
 * Editable Monaco pane for the SQL Editor. Splits the buffer (debounced) and
 * decorates each statement's first line with a gutter icon: green ✓ = looks
 * complete, amber ⚠ = incomplete (unclosed quote/parens, missing final `;`,
 * unknown leading keyword). Heuristic only — not validation.
 */
export const SqlEditorPane: React.FC<Props> = ({ value, dialect, onChange, onRun, reveal }) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decoRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const monacoTheme = useUiStore((s) => s.resolvedMode) === 'light' ? MONACO_THEME_LIGHT : MONACO_THEME;

  const decorate = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const statements = splitSqlStatements(text);
    decoRef.current?.clear?.();
    if (!statements.length) {
      decoRef.current = null;
      return;
    }
    decoRef.current = editor.createDecorationsCollection(
      statements.map((stmt) => {
        const status = checkStatement(stmt);
        const ok = status.level === 'ok';
        return {
          range: { startLineNumber: stmt.startLine, startColumn: 1, endLineNumber: stmt.startLine, endColumn: 1 },
          options: {
            glyphMarginClassName: ok ? 'fox-stmt-glyph-ok' : 'fox-stmt-glyph-warn',
            glyphMarginHoverMessage: {
              value: ok ? 'Statement looks complete' : status.reasons.join(' · '),
            },
          },
        };
      })
    );
  };

  // Re-decorate (debounced) whenever the buffer changes — including external
  // resets like loading a persisted buffer after mount.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => decorate(value), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal) return;
    const range = {
      startLineNumber: reveal.startLine,
      startColumn: 1,
      endLineNumber: reveal.endLine,
      endColumn: 1,
    };
    editor.revealRangeInCenter(range);
    editor.setSelection(range);
    editor.focus();
  }, [reveal]);

  useEffect(() => {
    return () => setSqlInsertHandler(null);
  }, []);

  return (
    <Editor
      height="100%"
      theme={monacoTheme}
      language={monacoLanguage(dialect)}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        ensureSqlCompletions(monaco);
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
        setSqlInsertHandler((text) => {
          const ed = editorRef.current;
          const m = monacoRef.current;
          if (!ed || !m) return;
          const sel = ed.getSelection();
          const pos = ed.getPosition();
          const range = sel && !sel.isEmpty()
            ? sel
            : pos
              ? new m.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
              : null;
          if (!range) return;
          ed.executeEdits('schema-insert', [{ range, text, forceMoveMarkers: true }]);
          ed.focus();
        });
        decorate(editor.getValue());
      }}
      options={EDITOR_OPTIONS}
    />
  );
};

export default SqlEditorPane;
