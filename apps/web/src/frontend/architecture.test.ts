/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The frontend's dependency rules, asserted rather than documented.
 *
 * A layering rule that lives only in a document is a rule that decays: nothing
 * fails when someone breaks it, and by the time anyone notices, the fix is a
 * week of untangling. `packages/sql` and `packages/shared` already guard their
 * boundaries this way, and it is the same idea here.
 *
 * The direction that matters is **shared must not depend on a feature**. When
 * it does, the shared module can no longer be reused without dragging a
 * business domain along, which is how a "shared" folder turns back into the
 * dumping ground the split was meant to end. That edge existed while this
 * refactor was in flight — `shared/api/lokeeApi.ts` imported the Lokee graph
 * DTO — and it was invisible until asserted.
 *
 * `app -> feature` is deliberately allowed: the shell composes features, which
 * is its job.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FE = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every module specifier in a file, from imports, dynamic imports and mocks. */
function specifiers(src: string): string[] {
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]/g,
    /vi\.(?:mock|doMock|importActual)\(\s*['"]([^'"]+)['"]/g,
  ];
  return patterns.flatMap((re) => [...src.matchAll(re)].map((m) => m[1]!));
}

interface Import {
  from: string;
  spec: string;
}

const imports: Import[] = sourceFiles(FE).flatMap((file) =>
  specifiers(fs.readFileSync(file, 'utf8')).map((spec) => ({
    from: path.relative(FE, file),
    spec,
  }))
);

/** Which top-level layer a file belongs to. */
const layerOf = (rel: string): string => rel.split(path.sep)[0]!;

/** The feature a specifier points into, if any. */
const featureTarget = (spec: string): string | null =>
  /^@\/features\/([^/]+)/.exec(spec)?.[1] ?? null;

describe('frontend layering', () => {
  it('covers the whole frontend', () => {
    // Guards against the walker matching nothing and passing vacuously.
    expect(sourceFiles(FE).length).toBeGreaterThan(150);
    expect(imports.length).toBeGreaterThan(300);
  });

  it('shared/ never depends on a feature', () => {
    const offenders = imports
      .filter((i) => layerOf(i.from) === 'shared' && featureTarget(i.spec))
      .map((i) => `${i.from} → ${i.spec}`);
    expect(offenders).toEqual([]);
  });

  it('one feature never reaches another feature\'s internals', () => {
    // Features genuinely compose here: the schema-diff renderers are shared
    // between Lokee history and object detail by design, and migrations embeds
    // the SQL editor. Banning that outright would push half the app into
    // shared/.
    //
    // So the line is drawn at *internals* — lib, api, store, utils — rather
    // than at the feature edge. A component is a UI surface another feature may
    // legitimately place; a lib function is an implementation detail, and
    // depending on one pins the owner's layout in place.
    //
    // The barrel is not required, and deliberately so: `@/features/utilities`
    // pulls every modal in that feature, which dragged Monaco into the admin
    // panel and broke tests that have nothing to do with an editor. A named
    // component import is the smaller dependency, and smaller is the point.
    const INTERNAL = ['lib', 'api', 'store', 'utils'];
    const offenders = imports
      .filter((i) => layerOf(i.from) === 'features')
      .filter((i) => {
        const target = featureTarget(i.spec);
        if (target === null || target === i.from.split(path.sep)[1]) return false;
        const rest = i.spec.slice(`@/features/${target}/`.length).split('/')[0];
        return INTERNAL.includes(rest);
      })
      .map((i) => `${i.from} → ${i.spec}`);
    expect(offenders).toEqual([]);
  });

  it('every feature that others consume has a public API', () => {
    const consumed = new Set(
      imports.map((i) => featureTarget(i.spec)).filter((f): f is string => f !== null)
    );
    const missing = [...consumed]
      .filter((f) => !fs.existsSync(path.join(FE, 'features', f, 'index.ts')))
      .sort();
    expect(missing).toEqual([]);
  });

  it('nothing imports the backend or the driver runtime', () => {
    // @foxschema/db is deliberately not aliased for the frontend build, so this
    // would fail at bundle time — but it fails here first, with a message that
    // says why instead of a resolver error.
    const banned = imports
      .filter((i) => i.spec === '@foxschema/db' || i.spec.startsWith('@foxschema/server'))
      .map((i) => `${i.from} → ${i.spec}`);
    expect(banned).toEqual([]);
  });

  it('no import escapes the frontend root', () => {
    // A `../../backend/...` climb is how the package boundary gets crossed by
    // accident once folders are nested deeper than people expect.
    const escapes = imports
      .filter((i) => i.spec.startsWith('.'))
      .filter((i) => {
        const resolved = path.resolve(FE, path.dirname(i.from), i.spec);
        return !resolved.startsWith(FE);
      })
      .map((i) => `${i.from} → ${i.spec}`);
    expect(escapes).toEqual([]);
  });
});
