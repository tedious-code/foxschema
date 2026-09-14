import { getPath } from '../../common/index.js';
/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/template.ts).
 */
/**
 * Mustache-lite interpolation: `{{path.to.value}}` resolved against a
 * variables object. Missing paths become empty strings. Used for URL,
 * query key/value, headers, and body templates on HTTP requests.
 */

const TOKEN = /\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g;
/** A string that is nothing but one token, e.g. `"{{records}}"`. */
const SOLE_TOKEN = /^\s*\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}\s*$/;

export function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(TOKEN, (_match, path: string) => {
    const value = getPath(variables, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  });
}

/**
 * Interpolate every string in a structure. A string that is *only* a token
 * (`"{{records}}"`) is replaced by the resolved value itself, so an array or
 * object substitutes structurally instead of being flattened to a JSON
 * string — which is what a bulk endpoint expecting `{"items": [...]}` needs.
 * Strings with surrounding text (`"got {{count}}"`) still stringify.
 */
export function interpolateDeep<T>(value: T, variables: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const sole = SOLE_TOKEN.exec(value);
    if (sole) {
      const resolved = getPath(variables, sole[1]!);
      // Scalars keep the string path so `"{{n}}"` stays "5" in a JSON body
      // exactly as before; only non-scalars substitute structurally.
      if (resolved !== null && typeof resolved === 'object') {
        return resolved as T;
      }
    }
    return interpolate(value, variables) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, variables)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        interpolate(key, variables),
        interpolateDeep(entry, variables),
      ]),
    ) as T;
  }
  return value;
}

