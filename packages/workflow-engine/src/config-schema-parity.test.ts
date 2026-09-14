/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/engine/src/config-schema-parity.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPipeRegistry } from './index.js';

/**
 * A pipe declares its config shape in two places: the Zod schema
 * `validateConfig` parses with, and the JSON Schema `metadata()` hands the
 * designer to build a form. When those disagree, the designer offers a field
 * the runtime rejects (or hides one it demands) and nothing fails until a user
 * hits it. Deriving one from the other (`definePipeMetadata`) prevents that
 * for migrated pipes; these tests hold the line for the rest.
 *
 * This lives in `@foxagent/engine` rather than in a pipe package because it
 * asserts a contract over *every* registered pipe — engine is the composition
 * root that already depends on all of them. `@foxagent/sdk`, where the
 * `PipeMetadata` contract is defined, cannot host it: every pipe package
 * depends on the SDK, so the test would close a dependency cycle.
 */
describe('pipe config schema parity', () => {
  const registry = createDefaultPipeRegistry();
  const all = registry.listMetadata();

  it('registers pipes to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all.map((meta) => [meta.type, meta] as const))(
    '%s declares an object schema with named properties',
    (_type, meta) => {
      expect(meta.configSchema.type).toBe('object');
      const properties = meta.configSchema.properties as
        | Record<string, unknown>
        | undefined;
      // `simple` pipes (manual trigger) legitimately have no settings.
      if (meta.simple && !properties) return;
      expect(properties, 'configSchema.properties').toBeTypeOf('object');
    },
  );

  it.each(all.map((meta) => [meta.type, meta] as const))(
    '%s only marks properties it declares as required',
    (_type, meta) => {
      const required = (meta.configSchema.required ?? []) as string[];
      const properties = Object.keys(
        (meta.configSchema.properties ?? {}) as Record<string, unknown>,
      );
      // A required key with no property definition renders as a mandatory
      // field the designer cannot draw an input for.
      expect(required.filter((key) => !properties.includes(key))).toEqual([]);
    },
  );

  it.each(all.map((meta) => [meta.type, meta] as const))(
    '%s rejects an empty config when it declares required fields',
    (_type, meta) => {
      const required = (meta.configSchema.required ?? []) as string[];
      if (required.length === 0) return;

      // `registry.get` is the path a run takes, and it validates. The designer
      // trusts `required` to decide what to insist on before save; if the
      // runtime accepts a config missing those keys, the two descriptions of
      // the same pipe have drifted apart.
      expect(
        () =>
          registry.get({
            id: 'probe',
            type: meta.type,
            role: meta.role,
            config: {},
            concurrency: 1,
          }),
        `${meta.type} declares required ${required.join(', ')} but accepted {}`,
      ).toThrow();
    },
  );
});
