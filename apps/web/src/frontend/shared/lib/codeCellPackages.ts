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

/** Small enough to bundle with the cell runtime; keyed by import specifier. */
export const CODE_CELL_PACKAGE_MODULES: Record<string, object> = {
  lodash: lodash as object,
  'lodash-es': lodash as object,
  'date-fns': dateFns as object,
};

/**
 * faker is ~400 kB minified, so it is fetched on demand instead of riding along
 * in the editor's eager chunks — statically importing it here also lands it in
 * the store chunk via the in-process fallback path, which is loaded as soon as
 * the SQL Editor opens.
 */
let fakerModulePromise: Promise<object> | null = null;

function loadFakerModule(): Promise<object> {
  if (!fakerModulePromise) {
    // Locale entry, not the package root: the root re-exports every locale.
    fakerModulePromise = import('@faker-js/faker/locale/en').then(({ faker }) => ({
      faker,
      // The real package has no default export, but a cell writing
      // `import faker from '@faker-js/faker'` should still get the instance.
      default: faker,
    }));
  }
  return fakerModulePromise;
}

/** True when the body imports a package whose namespace is loaded on demand. */
function needsFaker(body: string): boolean {
  return body.includes('@faker-js/faker');
}

/**
 * Module namespaces for one cell body: the bundled set, plus any on-demand
 * package the body actually imports.
 */
export async function loadCodeCellPackageModules(
  body: string
): Promise<Record<string, object>> {
  if (!needsFaker(body)) return CODE_CELL_PACKAGE_MODULES;
  return { ...CODE_CELL_PACKAGE_MODULES, '@faker-js/faker': await loadFakerModule() };
}

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
