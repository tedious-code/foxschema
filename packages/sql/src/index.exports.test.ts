/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The package index must re-export everything a module index makes public.
 *
 * A module can be fully tested and still be unreachable: the module's own tests
 * import it by path, so a missing line in `src/index.ts` breaks nothing until an
 * app tries to import the symbol. That happened twice while Lokee Weave was
 * being built — first with the reversal exports, then when two merges collided
 * in the module index and left it syntactically invalid. Both were found by
 * something downstream rather than here.
 *
 * Value-level re-exports are checked by comparison. Types are erased at runtime,
 * so those are checked by the `import type` block below: if a type stops being
 * exported from the package root, this file stops compiling.
 */
import { describe, expect, it } from 'vitest';
import * as packageIndex from './index.js';
import * as lokeeWeave from './modules/lokee-weave/index.js';

// Compile-time half: these resolve through the package root, not the module.
// Deleting any of them from src/index.ts is a typecheck failure, not a silent
// gap. Keep this list in step with the runtime check below.
import type {
  CanonicalObject,
  ChangeOperation,
  DatabaseIdentityInput,
  Digest,
  GraphNode,
  GraphResult,
  HistoryWindow,
  LatestIndex,
  LokeeObjectType,
  ObjectChange,
  ObjectHistoryPoint,
  ReversalPlan,
  ReversalRisk,
  ReversalVerdict,
  TimePoint,
  WeaveCapture,
  WeaveObject,
  WindowResult,
} from './index.js';

describe('src/index.ts re-exports every public value from the module indexes', () => {
  // Add a module here when it grows a public index; the assertion is generic.
  const modules: Array<[string, Record<string, unknown>]> = [
    ['lokee-weave', lokeeWeave as Record<string, unknown>],
  ];

  it.each(modules)('%s', (_name, mod) => {
    const missing = Object.keys(mod).filter((key) => !(key in packageIndex));
    expect(missing).toEqual([]);
  });

  it('exports the same binding, not a copy that can drift', () => {
    // A hand-written re-implementation in index.ts would pass the key check
    // above while behaving differently.
    for (const [key, value] of Object.entries(lokeeWeave)) {
      expect((packageIndex as Record<string, unknown>)[key], key).toBe(value);
    }
  });
});

describe('the lokee-weave module index is itself loadable', () => {
  it('exposes the capture entry points', () => {
    // A blunt smoke check: the collision that broke main left this module
    // unparseable, which fails the import above before reaching any assertion.
    expect(typeof lokeeWeave.weave).toBe('function');
    expect(typeof lokeeWeave.canonicalizeSchema).toBe('function');
    expect(typeof lokeeWeave.planReversal).toBe('function');
    expect(typeof lokeeWeave.windowGraph).toBe('function');
  });
});

// Reference the imported types so the block above is not elided as unused.
type _AssertTypesReachable = [
  CanonicalObject,
  ChangeOperation,
  DatabaseIdentityInput,
  Digest,
  GraphNode,
  GraphResult<GraphNode>,
  HistoryWindow,
  LatestIndex,
  LokeeObjectType,
  ObjectChange,
  ObjectHistoryPoint,
  ReversalPlan,
  ReversalRisk,
  ReversalVerdict,
  TimePoint,
  WeaveCapture,
  WeaveObject,
  WindowResult<unknown>,
];
