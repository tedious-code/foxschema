import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  MONACO_THEME,
  MONACO_THEME_LIGHT,
  monacoLanguage,
  FOXSCHEMA_SQL_LANG,
  MONACO_EDITOR_BASE_OPTIONS,
} from '../../monaco-setup';
import { ensureFoxschemaSqlLanguage } from '../../lib/foxschemaSqlLanguage';
import { MONACO_FONT_PX, useUiStore } from '../../store/uiStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { checkStatement, type SplitStatement } from '../../lib/sql-splitter';
import { ensureSqlCompletions } from './completion';
import { setSqlInsertHandler, setSqlSelectionGetter } from './sqlEditorBridge';
import { buildVariableHoverDecorations } from './variableHover';

export interface RevealRequest {
  startLine: number;
  endLine: number;
  /** Bump to re-trigger reveal for the same range. */
  nonce: number;
}

interface Props {
  value: string;
  /** Pre-split statements from the parent (one parse per keystroke). */
  statements: SplitStatement[];
  dialect: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter shortcut → run. */
  onRun?: () => void;
  /** Fired when Monaco selection becomes empty / non-empty (for Run label). */
  onSelectionChange?: (hasSelection: boolean) => void;
  /** Statement strip click → scroll/select that range. */
  reveal?: RevealRequest | null;
}

/**
 * Editable Monaco pane for the SQL Editor. Uses parent-provided statement
 * splits and decorates each statement's first line with a gutter icon: green ✓
 * = looks complete, amber ⚠ = incomplete (unclosed quote/parens, missing final
 * `;`, unknown leading keyword). Heuristic only — not validation.
 */
export const SqlEditorPane: React.FC<Props> = ({
  value,
  statements,
  dialect,
  onChange,
  onRun,
  onSelectionChange,
  reveal,
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decoRef = useRef<any>(null);
  const varDecoRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const monacoTheme = useUiStore((s) => s.resolvedMode) === 'light' ? MONACO_THEME_LIGHT : MONACO_THEME;
  const fontSizePref = useUiStore((s) => s.fontSize);
  const monacoFontSize = MONACO_FONT_PX[fontSizePref] ?? MONACO_FONT_PX.md;
  const variables = useSqlEditorStore((s) => s.variables);
  const [editorLanguage, setEditorLanguage] = useState(() => monacoLanguage(dialect));

  const editorOptions = useMemo(
    () => ({
      ...MONACO_EDITOR_BASE_OPTIONS,
      renderLineHighlight: 'line' as const,
      fontSize: monacoFontSize,
      glyphMargin: true,
      tabSize: 2,
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
    }),
    [monacoFontSize]
  );

  // Keep a live editor in sync when the appearance font size changes.
  useEffect(() => {
    editorRef.current?.updateOptions?.({ fontSize: monacoFontSize });
  }, [monacoFontSize]);

  const decorate = (text: string, stmts: SplitStatement[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor) return;
    decoRef.current?.clear?.();
    if (!stmts.length) {
      decoRef.current = null;
    } else {
      decoRef.current = editor.createDecorationsCollection(
        stmts.map((stmt) => {
          const status = checkStatement(stmt);
          const ok = status.level === 'ok';
          return {
            range: {
              startLineNumber: stmt.startLine,
              startColumn: 1,
              endLineNumber: stmt.startLine,
              endColumn: 1,
            },
            options: {
              glyphMarginClassName: ok ? 'fox-stmt-glyph-ok' : 'fox-stmt-glyph-warn',
              glyphMarginHoverMessage: {
                value: ok ? 'Statement looks complete' : status.reasons.join(' · '),
              },
            },
          };
        })
      );
    }

    varDecoRef.current?.clear?.();
    if (monaco) {
      const vars = useSqlEditorStore.getState().variables;
      const varDecos = buildVariableHoverDecorations(monaco, text, vars);
      varDecoRef.current =
        varDecos.length > 0 ? editor.createDecorationsCollection(varDecos) : null;
    }
  };

  // Re-decorate (debounced) whenever the buffer, splits, or variables change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => decorate(value, statements), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, statements, variables]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal) return;
    const model = editor.getModel();
    const endColumn = model ? model.getLineMaxColumn(reveal.endLine) : 1;
    const range = {
      startLineNumber: reveal.startLine,
      startColumn: 1,
      endLineNumber: reveal.endLine,
      endColumn,
    };
    editor.revealRangeInCenter(range);
    editor.setSelection(range);
    editor.focus();
    onSelectionChangeRef.current?.(true);
  }, [reveal]);

  useEffect(() => {
    return () => {
      setSqlInsertHandler(null);
      setSqlSelectionGetter(null);
    };
  }, []);

  useEffect(() => {
    setEditorLanguage((prev) =>
      prev === FOXSCHEMA_SQL_LANG ? prev : monacoLanguage(dialect)
    );
  }, [dialect]);

  return (
    <Editor
      height="100%"
      theme={monacoTheme}
      language={editorLanguage}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        ensureSqlCompletions(monaco);
        // Upgrade to SQL+JS/TS highlighting after packs load (never block mount).
        void ensureFoxschemaSqlLanguage(monaco).then((ok) => {
          if (!ok) return;
          setEditorLanguage(FOXSCHEMA_SQL_LANG);
          const model = editor.getModel();
          if (model) monaco.editor.setModelLanguage(model, FOXSCHEMA_SQL_LANG);
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
        setSqlSelectionGetter(() => {
          const ed = editorRef.current;
          const model = ed?.getModel?.();
          const sel = ed?.getSelection?.();
          if (!ed || !model || !sel || sel.isEmpty()) return null;
          const text = model.getValueInRange(sel);
          const trimmed = text.trim();
          return trimmed.length > 0 ? trimmed : null;
        });
        editor.onDidChangeCursorSelection(() => {
          const sel = editor.getSelection();
          onSelectionChangeRef.current?.(Boolean(sel && !sel.isEmpty()));
        });
        setSqlInsertHandler((text) => {
          const ed = editorRef.current;
          const m = monacoRef.current;
          if (!ed || !m) return;
          const sel = ed.getSelection();
          const pos = ed.getPosition();
          const range =
            sel && !sel.isEmpty()
              ? sel
              : pos
                ? new m.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
                : null;
          if (!range) return;
          ed.executeEdits('schema-insert', [{ range, text, forceMoveMarkers: true }]);
          ed.focus();
        });
        decorate(editor.getValue(), statements);
      }}
      options={editorOptions}
    />
  );
};

export default SqlEditorPane;
