/**
 * FoxScript structural diagnostics → Monaco markers.
 * Severity is warning/info (not "invalid SQL") — matches checkStatement honesty.
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
  parseFoxScript,
  type FoxScriptDiagnostic,
} from '@foxschema/core';
import { FOXSCRIPT_LANG, FOXSCHEMA_SQL_LANG } from '../../lib/foxschemaSqlLanguage';

const OWNER = 'foxscript';

function toMarker(
  monaco: typeof Monaco,
  d: FoxScriptDiagnostic
): Monaco.editor.IMarkerData {
  const severity =
    d.severity === 'error'
      ? monaco.MarkerSeverity.Error
      : d.severity === 'info'
        ? monaco.MarkerSeverity.Info
        : monaco.MarkerSeverity.Warning;
  return {
    severity,
    message: d.message,
    code: d.code,
    startLineNumber: d.range.startLine,
    startColumn: 1,
    endLineNumber: d.range.endLine,
    endColumn: 1,
    source: 'FoxScript',
  };
}

/** Apply FoxScript structural markers on a model (debounced by caller). */
export function applyFoxscriptMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
): void {
  const lang = model.getLanguageId();
  if (lang !== FOXSCRIPT_LANG && lang !== FOXSCHEMA_SQL_LANG) {
    monaco.editor.setModelMarkers(model, OWNER, []);
    return;
  }
  const doc = parseFoxScript(model.getValue());
  const markers = doc.diagnostics
    .filter((d) => d.code !== 'empty-document')
    .map((d) => toMarker(monaco, d));
  monaco.editor.setModelMarkers(model, OWNER, markers);
}

export function clearFoxscriptMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
): void {
  monaco.editor.setModelMarkers(model, OWNER, []);
}
