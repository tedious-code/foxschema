/**
 * Allowlisted packages for SQL Editor JS/TS code cells, bundled for the browser.
 * The import parser itself lives in `@foxschema/sql` and is shared with the
 * Node executor — this module only supplies the browser's module namespaces.
 */

import * as lodash from 'lodash-es';
import * as dateFns from 'date-fns';
import {
  CODE_CELL_ALLOWED_PACKAGES,
  parseCodeCellImports,
  resolveCodeCellImportBindings as resolveBindings,
  prepareCodeCellImports as prepareImports,
  type CodeCellAllowedPackage,
  type CodeCellImportSpec,
} from './sql-splitter';

export { CODE_CELL_ALLOWED_PACKAGES, parseCodeCellImports };
export type { CodeCellAllowedPackage, CodeCellImportSpec };

/** Bundled module namespaces keyed by import specifier. */
export const CODE_CELL_PACKAGE_MODULES: Record<CodeCellAllowedPackage, object> = {
  lodash: lodash as object,
  'lodash-es': lodash as object,
  'date-fns': dateFns as object,
};

/** Build identifier → value bindings from the browser's bundled packages. */
export function resolveCodeCellImportBindings(
  specs: CodeCellImportSpec[],
  modules: Record<string, object> = CODE_CELL_PACKAGE_MODULES
): { ok: true; bindings: Record<string, unknown> } | { ok: false; error: string } {
  return resolveBindings(specs, modules);
}

/** Parse + resolve imports in one step. */
export function prepareCodeCellImports(
  body: string,
  modules: Record<string, object> = CODE_CELL_PACKAGE_MODULES
): { ok: true; body: string; bindings: Record<string, unknown> } | { ok: false; error: string } {
  return prepareImports(body, modules);
}
