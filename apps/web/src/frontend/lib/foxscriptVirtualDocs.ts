/**
 * FoxScript virtual documents for embedded code cells.
 *
 * Each `-- @js` / `-- @ts` / `-- @node` / `-- @nodets` fence maps to an
 * in-memory Monaco model. Providers (hover/complete) project the cell body
 * with a typed prelude so `last`, `vars`, and `sql` are discoverable without
 * a custom JS parser.
 *
 * Full TS language-service diagnostics need a TS worker (not shipped in the
 * SQL-only Monaco bundle yet) — structural FoxScript markers cover fences.
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { parseFoxScript, type FoxScriptCodeBlock } from '@foxschema/core';

const PRELUDE_JS = `/** FoxScript cell prelude — injected for IntelliSense only */
/** @typedef {{ columns: string[], rows: unknown[][], rowCount: number }} FoxGrid */
/** @type {FoxGrid | null} */
var last = null;
/** @type {Record<string, { value?: unknown, values?: unknown[], columns?: string[], rows?: unknown[][] }>} */
var vars = {};
/**
 * @type {{
 *   (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>,
 *   id: (...parts: string[]) => unknown,
 *   values: (rows: Record<string, unknown>[], columns?: string[]) => unknown,
 *   list: (values: unknown[]) => unknown,
 *   raw: (text: string) => unknown,
 * }}
 */
var sql = Object.assign(async function sql() { return []; }, { id(){}, values(){}, list(){}, raw(){} });
`;

const PRELUDE_TS = `/** FoxScript cell prelude — injected for IntelliSense only */
type FoxGrid = { columns: string[]; rows: unknown[][]; rowCount: number };
declare const last: FoxGrid | null;
declare const vars: Record<
  string,
  { value?: unknown; values?: unknown[]; columns?: string[]; rows?: unknown[][] }
>;
declare const sql: {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  id(...parts: string[]): unknown;
  values(rows: Record<string, unknown>[], columns?: string[]): unknown;
  list(values: unknown[]): unknown;
  raw(text: string): unknown;
};
`;

export type FoxscriptVirtualDoc = {
  uri: Monaco.Uri;
  model: Monaco.editor.ITextModel;
  blockIndex: number;
  /** Character length of the prelude prepended to the cell body. */
  preludeLength: number;
  /** Start offset of the cell body in the parent FoxScript document. */
  bodyStartInParent: number;
};

const docsByParent = new WeakMap<Monaco.editor.ITextModel, FoxscriptVirtualDoc[]>();

function preludeFor(kind: FoxScriptCodeBlock['kind']): string {
  return kind === 'ts' || kind === 'nodets' ? PRELUDE_TS : PRELUDE_JS;
}

function languageFor(kind: FoxScriptCodeBlock['kind']): string {
  return kind === 'ts' || kind === 'nodets' ? 'typescript' : 'javascript';
}

function bodyStartOffset(parentValue: string, block: FoxScriptCodeBlock): number {
  // Body begins after the opening fence line within block.text.
  const openNl = block.text.indexOf('\n');
  if (openNl < 0) return block.range.start;
  return block.range.start + openNl + 1;
}

/**
 * Sync in-memory models for every code block in `parent`.
 * Returns the active virtual docs (caller may register providers once).
 */
export function syncFoxscriptVirtualDocs(
  monaco: typeof Monaco,
  parent: Monaco.editor.ITextModel
): FoxscriptVirtualDoc[] {
  const prev = docsByParent.get(parent) ?? [];
  for (const d of prev) d.model.dispose();

  const doc = parseFoxScript(parent.getValue());
  const next: FoxscriptVirtualDoc[] = [];
  const parentUri = parent.uri.toString(true);

  for (const block of doc.blocks) {
    if (block.type !== 'code') continue;
    const prelude = preludeFor(block.kind);
    const uri = monaco.Uri.parse(
      `inmemory://foxscript/${encodeURIComponent(parentUri)}/cell-${block.index}.${
        block.kind === 'ts' || block.kind === 'nodets' ? 'ts' : 'js'
      }`
    );
    const existing = monaco.editor.getModel(uri);
    existing?.dispose();
    const model = monaco.editor.createModel(
      prelude + block.body,
      languageFor(block.kind),
      uri
    );
    next.push({
      uri,
      model,
      blockIndex: block.index,
      preludeLength: prelude.length,
      bodyStartInParent: bodyStartOffset(parent.getValue(), block),
    });
  }

  docsByParent.set(parent, next);
  return next;
}

export function getFoxscriptVirtualDocs(
  parent: Monaco.editor.ITextModel
): FoxscriptVirtualDoc[] {
  return docsByParent.get(parent) ?? [];
}

export function disposeFoxscriptVirtualDocs(parent: Monaco.editor.ITextModel): void {
  const prev = docsByParent.get(parent) ?? [];
  for (const d of prev) d.model.dispose();
  docsByParent.delete(parent);
}

/** Map a parent-document position into a virtual cell model (if inside a fence body). */
export function projectToVirtualDoc(
  parent: Monaco.editor.ITextModel,
  position: Monaco.Position
): { doc: FoxscriptVirtualDoc; position: Monaco.Position } | null {
  const offset = parent.getOffsetAt(position);
  const docs = getFoxscriptVirtualDocs(parent);
  const fox = parseFoxScript(parent.getValue());
  for (const doc of docs) {
    const block = fox.blocks[doc.blockIndex];
    if (!block || block.type !== 'code') continue;
    const bodyStart = doc.bodyStartInParent;
    const bodyEnd = block.terminated
      ? block.range.end - (block.text.match(/\n[^\n]*--\s*@end[^\n]*$/i)?.[0]?.length ?? 0)
      : block.range.end;
    if (offset < bodyStart || offset > bodyEnd) continue;
    const localOffset = doc.preludeLength + (offset - bodyStart);
    const pos = doc.model.getPositionAt(Math.max(0, Math.min(localOffset, doc.model.getValueLength())));
    return { doc, position: pos };
  }
  return null;
}

const BUILTIN_COMPLETIONS = [
  { label: 'last', detail: 'FoxGrid | null — previous statement result' },
  { label: 'vars', detail: 'FoxScript variables / secrets' },
  { label: 'sql', detail: 'Tagged template — Node cells only (bind parameters)' },
  { label: 'return', detail: 'Return a grid or array of objects' },
];

let providersRegistered = false;

/** Register hover + completion once for FoxScript virtual-doc projection. */
export function ensureFoxscriptVirtualProviders(monaco: typeof Monaco): void {
  if (providersRegistered) return;
  providersRegistered = true;

  const langs = ['foxscript', 'foxschema-sql'];

  for (const language of langs) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.'],
      provideCompletionItems(model, position) {
        const projected = projectToVirtualDoc(model, position);
        if (!projected) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: BUILTIN_COMPLETIONS.map((c) => ({
            label: c.label,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: c.detail,
            insertText: c.label,
            range,
          })),
        };
      },
    });

    monaco.languages.registerHoverProvider(language, {
      provideHover(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const projected = projectToVirtualDoc(model, position);
        if (!projected) return null;
        const hit = BUILTIN_COMPLETIONS.find((c) => c.label === word.word);
        if (!hit) return null;
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [
            { value: `**${hit.label}**` },
            { value: hit.detail },
          ],
        };
      },
    });
  }
}
