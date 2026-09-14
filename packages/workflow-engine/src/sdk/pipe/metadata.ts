/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/metadata.ts).
 */
import type { TriggerKind } from '../../common/index.js';
import type { PipeFamily, PipeRole } from '../../common/index.js';
import { toJSONSchema, type $ZodType } from 'zod/v4/core';

/** Named input/output port for registry-driven designer and routing. */
export interface PortDef {
  name: string;
  type: 'records' | 'json' | 'binary';
}

/**
 * Who a pipe belongs to. Stamped by the registry/loader at registration time —
 * anything a pipe self-declares here is overwritten, so a plugin cannot
 * impersonate a built-in (see docs/engine-evolution.md).
 */
export interface PipeProvider {
  /** Publisher namespace: `foxagent` for built-ins, plugin namespace otherwise. */
  namespace: string;
  origin: 'builtin' | 'plugin';
  /** Plugin package identity, e.g. `@acme/foxflow-postgres-extra`. */
  package?: string;
  packageVersion?: string;
}

/**
 * Stable pipe identity for palette, property panels, and plugin manifests.
 * Phase 1: every built-in connector exposes this via `metadata()`.
 */
export interface PipeMetadata {
  type: string;
  name: string;
  /**
   * Palette placement, optionally two levels as `Group/Subgroup`
   * (e.g. `Sources/Database`). A subgroup names the *origin* of the data —
   * where bytes come from — never its format or what you do to it; format and
   * dialect stay pipe config. Pipes that consume an input port belong under a
   * transform group, not `Sources/*`.
   */
  category: string;
  version: string;
  role: Exclude<PipeRole, 'trigger'>;
  inputs: PortDef[];
  outputs: PortDef[];
  /** JSON Schema describing `pipe.config` (UI + validation docs). */
  configSchema: Record<string, unknown>;
  /**
   * No meaningful pipe-level settings (e.g. manual trigger). The designer
   * hides type/credential/concurrency/retry and raw JSON editing when true.
   */
  simple?: boolean;
  /**
   * This pipe reaches something outside the process — a paid API, another
   * workflow, a browser — so a dry run must stand in for it rather than let it
   * happen. Sinks are substituted by role and do not need the flag; it exists
   * for *transforms*, which a dry run would otherwise execute for real.
   */
  sideEffects?: boolean;
  /**
   * This pipe is the data-plane face of a workflow-level trigger of this kind
   * (`*` accepts any). Activation config stays on `workflow.triggers` — the
   * pipe only binds to one via `config.triggerId`, and the designer offers a
   * picker plus a jump into the trigger's settings.
   */
  triggerKind?: TriggerKind | '*';
  /**
   * Palette visibility. `primary` (default) shows in the Nodes list;
   * `advanced` is hidden until the designer enables “Show advanced pipes”.
   * Use for atomic building blocks that would otherwise create jungle charts
   * (e.g. individual `browser.click` / `browser.fill`).
   */
  palette?: 'primary' | 'advanced';
  /**
   * Capability pack this pipe belongs to (auth, notify, integration.google, …).
   * Orthogonal to `category`. See docs/pipe-families.md.
   */
  family?: PipeFamily;
  /** Free-form search tags for agents and the designer filter. */
  tags?: string[];
  /** Loader-stamped provenance; self-declared values are overwritten. */
  provider?: PipeProvider;
}

/**
 * What a pipe hands to {@link definePipeMetadata}: everything in
 * {@link PipeMetadata}, except `configSchema` may be the Zod schema the pipe
 * already validates `config` with, instead of a hand-written JSON Schema.
 */
export interface PipeMetadataInput extends Omit<PipeMetadata, 'configSchema'> {
  configSchema: Record<string, unknown> | $ZodType;
}

function isZodSchema(value: object): value is $ZodType {
  return '_zod' in value;
}

/**
 * Derivation is not free (~0.2ms for the text source's nested column rules)
 * and `metadata()` is not only called at startup: the executor reads
 * `metadata().outputs` through `defaultOutputPort` once per batch, per pipe.
 * A pipe's config schema is a module-level constant, so the derived result is
 * cached against its identity and each schema is converted once per process.
 */
const derived = new WeakMap<$ZodType, Record<string, unknown>>();

/**
 * Derive the designer's JSON Schema from a pipe's Zod config schema.
 *
 * `io: 'input'` is the mode that matches what a config *author* writes: a
 * field with a `.default()` is optional to supply (output mode would list it
 * as required because it is always present after parsing).
 *
 * Zod constructs that JSON Schema cannot express — `.refine()`, `.transform()`
 * — are dropped rather than throwing. Those are cross-field rules the runtime
 * `parse` still enforces; the designer just cannot render them as a field.
 */
function jsonSchemaFor(schema: $ZodType): Record<string, unknown> {
  const cached = derived.get(schema);
  if (cached) return cached;

  const { $schema: _ignored, ...rest } = toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  const result = stripSafeIntegerBounds(rest) as Record<string, unknown>;
  derived.set(schema, result);
  return result;
}

/**
 * `z.number().int()` emits ±`Number.MAX_SAFE_INTEGER` as the bounds of the
 * integer type itself. The designer binds `maximum` straight onto the number
 * input, so leaving them in shows an author-declared limit where there is
 * none. Real `.min()`/`.max()` values are untouched.
 */
function stripSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntegerBounds);
  if (node === null || typeof node !== 'object') return node;

  const entries = Object.entries(node as Record<string, unknown>).filter(
    ([key, value]) =>
      !(
        (node as Record<string, unknown>).type === 'integer' &&
        ((key === 'maximum' && value === Number.MAX_SAFE_INTEGER) ||
          (key === 'minimum' && value === -Number.MAX_SAFE_INTEGER))
      ),
  );
  return Object.fromEntries(
    entries.map(([key, value]) => [key, stripSafeIntegerBounds(value)]),
  );
}

/**
 * Pass the pipe's own Zod schema as `configSchema` — a pipe that writes its
 * config shape twice (Zod for `validateConfig`, JSON Schema for the designer)
 * has two copies that drift apart silently, and nothing fails when they do.
 */
export function definePipeMetadata(meta: PipeMetadataInput): PipeMetadata {
  const { configSchema, ...rest } = meta;
  return {
    ...rest,
    configSchema: isZodSchema(configSchema)
      ? jsonSchemaFor(configSchema)
      : configSchema,
  };
}
