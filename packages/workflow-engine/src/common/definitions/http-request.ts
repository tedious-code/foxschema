/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/definitions/http-request.ts).
 */
import { z } from 'zod';

/**
 * Shared outbound HTTP request shape used by:
 * - `source.api.http` pipe config (plus source-only fields)
 * - cron trigger `executionType: 'http'` (`trigger.http`)
 *
 * Keep one schema so schedule HTTP jobs and the HTTP pipe never drift.
 *
 * Strings may contain `{{path.to.value}}` templates resolved at execute time
 * against pipe variables + trigger payload + credential fields.
 */

/**
 * Condition operators for query params. `eq` (the default) serializes as a
 * plain `key=value`; every other operator uses bracket style: `key[op]=value`
 * (e.g. `price[gte]=100`, `status[in]=a,b`, `age[range]=18,30`).
 */
export const HTTP_KV_OPS = [
  'eq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'or',
  'range',
] as const;
export type HttpKvOp = (typeof HTTP_KV_OPS)[number];

const kvSchema = z.object({
  key: z.string().min(1),
  value: z.string().default(''),
  enabled: z.boolean().default(true),
  /** Condition operator (query params only). Absent means `eq`. */
  op: z.enum(HTTP_KV_OPS).optional(),
  /**
   * Optional path into the variables object that supplies `value` when set
   * (e.g. `trigger.userId` or `vars.page`). Overrides the static `value`.
   * Legacy — no longer exposed in the designer, still honored at runtime.
   */
  valueFrom: z.string().min(1).optional(),
  /** Optional path that supplies `key` when set. */
  keyFrom: z.string().min(1).optional(),
});
export type HttpKv = z.infer<typeof kvSchema>;

/** `key[op]=value` bracket serialization; `eq`/absent stays a plain key. */
export function httpKvQueryKey(row: Pick<HttpKv, 'key' | 'op'>): string {
  return row.op && row.op !== 'eq' ? `${row.key}[${row.op}]` : row.key;
}

export const httpTokenRefreshSchema = z.object({
  enabled: z.boolean().default(false),
  /** Token endpoint URL (templates allowed). */
  url: z.string().min(1),
  method: z.enum(['POST', 'PUT']).default('POST'),
  headers: z.array(kvSchema).default([]),
  body: z
    .object({
      mode: z.enum(['json', 'form']).default('json'),
      /** For json mode — object; for form mode — kv rows. Templates ok. */
      json: z.unknown().optional(),
      form: z.array(kvSchema).default([]),
    })
    // `prefault`: the default is parsed like input, so `form` still gets its own
    // default — zod 4's `.default()` would return this object as-is.
    .prefault({ mode: 'json', json: { refresh_token: '{{secrets.refreshToken}}', grant_type: 'refresh_token' } }),
  accessTokenPath: z.string().min(1).default('access_token'),
  refreshTokenPath: z.string().min(1).optional(),
  expiresInPath: z.string().min(1).default('expires_in'),
  /** Retry original request after refresh when response status is in this list. */
  onStatus: z.array(z.number().int()).default([401]),
  /** Refresh proactively when expiresAt is within this many seconds. */
  skewSeconds: z.number().int().min(0).default(60),
});
export type HttpTokenRefresh = z.infer<typeof httpTokenRefreshSchema>;

export const httpSessionSchema = z.object({
  /** Capture Set-Cookie and send Cookie on later requests. */
  enabled: z.boolean().default(false),
  /**
   * Persist cookies into the linked credential secret (`cookies` field) so
   * later runs skip re-login. Requires auth.credential / pipe credentialId.
   */
  persistToCredential: z.boolean().default(true),
});
export type HttpSession = z.infer<typeof httpSessionSchema>;

export const httpAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('bearer'),
    /** Static or templated token, e.g. `{{secrets.accessToken}}`. */
    token: z.string().min(1),
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string().min(1),
    password: z.string().default(''),
  }),
  z.object({
    type: z.literal('apiKey'),
    key: z.string().min(1),
    value: z.string().min(1),
    in: z.enum(['header', 'query']).default('header'),
  }),
  z.object({
    type: z.literal('credential'),
    /** Stored credential id (`http` or `oauth` kind); revealed only at execute time. */
    credentialId: z.string().min(1),
  }),
]);
export type HttpAuth = z.infer<typeof httpAuthSchema>;

/** Typed attribute rows for the structured `fields` body builder. */
export const HTTP_BODY_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'json',
] as const;
export type HttpBodyFieldType = (typeof HTTP_BODY_FIELD_TYPES)[number];

const bodyFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(HTTP_BODY_FIELD_TYPES).default('string'),
  /** Raw text, template-able; converted per `type` at send time. */
  value: z.string().default(''),
  enabled: z.boolean().default(true),
});
export type HttpBodyField = z.infer<typeof bodyFieldSchema>;

/** Optional JSON Schema validated against the body before the request is sent. */
const bodyJsonSchema = z.record(z.string(), z.unknown()).optional();
/**
 * Designer provenance: the Zod source the schema was compiled from. The
 * designer evaluates it (client-side only) and stores the resulting JSON
 * Schema in `schema`; the runtime validates `schema` and never runs this code.
 */
const bodySchemaSource = z.string().optional();

export const httpBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal('json'),
    json: z.unknown(),
    schema: bodyJsonSchema,
    schemaSource: bodySchemaSource,
  }),
  z.object({
    mode: z.literal('raw'),
    raw: z.string(),
    contentType: z.string().min(1).default('text/plain'),
    schema: bodyJsonSchema,
    schemaSource: bodySchemaSource,
  }),
  z.object({
    mode: z.literal('form'),
    /** application/x-www-form-urlencoded fields */
    form: z.array(kvSchema).default([]),
    /** Validated against the composed `{key: value}` object of enabled rows. */
    schema: bodyJsonSchema,
    schemaSource: bodySchemaSource,
  }),
  z.object({
    mode: z.literal('fields'),
    /** Attribute builder — composes a JSON object from typed key/value rows. */
    fields: z.array(bodyFieldSchema).default([]),
    schema: bodyJsonSchema,
    schemaSource: bodySchemaSource,
  }),
]);
export type HttpBody = z.infer<typeof httpBodySchema>;

/** Thrown when a request body fails composition or its JSON Schema. */
export class HttpBodyValidationError extends Error {
  override name = 'HttpBodyValidationError';
}

/**
 * Compose the `fields` builder rows into the JSON object that gets sent.
 * Values arrive as (already-interpolated) strings and are converted per type;
 * a value that cannot convert is a config error, reported before any request.
 */
export function composeBodyFields(
  fields: HttpBodyField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.enabled || !field.key) continue;
    switch (field.type) {
      case 'string':
        out[field.key] = field.value;
        break;
      case 'number': {
        const parsed = Number(field.value);
        if (field.value.trim() === '' || Number.isNaN(parsed)) {
          throw new HttpBodyValidationError(
            `body field "${field.key}": "${field.value}" is not a number`,
          );
        }
        out[field.key] = parsed;
        break;
      }
      case 'boolean':
        if (field.value !== 'true' && field.value !== 'false') {
          throw new HttpBodyValidationError(
            `body field "${field.key}": expected true or false, got "${field.value}"`,
          );
        }
        out[field.key] = field.value === 'true';
        break;
      case 'json':
        try {
          out[field.key] = JSON.parse(field.value || 'null') as unknown;
        } catch {
          throw new HttpBodyValidationError(
            `body field "${field.key}": value is not valid JSON`,
          );
        }
        break;
    }
  }
  return out;
}

function isTemplatedOrHttpUrl(value: string): boolean {
  if (value.includes('{{') && value.includes('}}')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const httpRequestSchema = z.object({
  url: z
    .string()
    .min(1)
    .refine(isTemplatedOrHttpUrl, {
      message: 'HTTP URL must use http/https or contain {{templates}}',
    }),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    .default('GET'),
  query: z.array(kvSchema).default([]),
  headers: z.array(kvSchema).default([]),
  auth: httpAuthSchema.default({ type: 'none' }),
  body: httpBodySchema.default({ mode: 'none' }),
  timeoutMs: z.number().int().positive().max(600_000).default(30_000),
  /**
   * Static variables available as `{{vars.*}}` (merged under `vars` and also
   * at the root for short `{{name}}` lookups).
   */
  variables: z.record(z.string(), z.unknown()).default({}),
  /** Cookie session reuse across requests / runs. */
  session: httpSessionSchema.default({ enabled: false, persistToCredential: true }),
  /** Auto-refresh access tokens (OAuth-style) using the linked credential. */
  tokenRefresh: httpTokenRefreshSchema.optional(),
});
export type HttpRequestDef = z.infer<typeof httpRequestSchema>;

/** JSON Schema fragment for designer / metadata (mirrors httpRequestSchema). */
export const httpRequestJsonSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      description: 'URL; supports {{variables}} e.g. https://api.example.com/users/{{vars.userId}}',
    },
    method: {
      type: 'string',
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
      default: 'GET',
    },
    query: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', minLength: 1 },
          value: { type: 'string', default: '' },
          enabled: { type: 'boolean', default: true },
          op: { type: 'string', enum: [...HTTP_KV_OPS], default: 'eq' },
          valueFrom: { type: 'string' },
          keyFrom: { type: 'string' },
        },
      },
      default: [],
    },
    headers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', minLength: 1 },
          value: { type: 'string', default: '' },
          enabled: { type: 'boolean', default: true },
          valueFrom: { type: 'string' },
          keyFrom: { type: 'string' },
        },
      },
      default: [],
    },
    auth: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['none', 'bearer', 'basic', 'apiKey', 'credential'],
        },
      },
    },
    body: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['none', 'json', 'raw', 'form', 'fields'],
        },
        schema: {
          type: 'object',
          description: 'JSON Schema checked against the body before sending',
        },
      },
    },
    timeoutMs: {
      type: 'integer',
      minimum: 1,
      maximum: 600_000,
      default: 30_000,
    },
    variables: { type: 'object', additionalProperties: true, default: {} },
    session: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        persistToCredential: { type: 'boolean', default: true },
      },
    },
    tokenRefresh: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        url: { type: 'string' },
        method: { type: 'string', enum: ['POST', 'PUT'] },
        accessTokenPath: { type: 'string', default: 'access_token' },
        onStatus: { type: 'array', items: { type: 'integer' } },
        skewSeconds: { type: 'integer', default: 60 },
      },
    },
  },
} as const;

/**
 * Coerce legacy flat HTTP configs (`headers` as object, raw `body`) into the
 * shared request shape so saved workflows keep working.
 */
export function coerceHttpRequest(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;

  // Nested `request` object (pipe may wrap shared fields).
  if (raw.request && typeof raw.request === 'object') {
    return coerceHttpRequest(raw.request);
  }

  const headers = normalizeKv(raw.headers);
  const query = normalizeKv(raw.query);
  let body = raw.body;
  if (
    body === undefined ||
    body === null ||
    (typeof body === 'object' && 'mode' in (body as object))
  ) {
    // already structured or absent
  } else if (typeof body === 'string') {
    body = { mode: 'raw', raw: body, contentType: 'text/plain' };
  } else {
    body = { mode: 'json', json: body };
  }

  let auth = raw.auth;
  if (!auth || typeof auth !== 'object') {
    auth = { type: 'none' };
  }

  return {
    url: raw.url,
    method: raw.method ?? 'GET',
    query,
    headers,
    auth,
    body: body ?? { mode: 'none' },
    timeoutMs: raw.timeoutMs ?? 30_000,
    variables: raw.variables ?? {},
    session: raw.session ?? { enabled: false, persistToCredential: true },
    tokenRefresh: raw.tokenRefresh,
  };
}

function normalizeKv(value: unknown): Array<{
  key: string;
  value: string;
  enabled: boolean;
  op?: HttpKvOp;
  valueFrom?: string;
  keyFrom?: string;
}> {
  if (Array.isArray(value)) {
    return value
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .map((row) => ({
        key: String(row.key ?? ''),
        value: String(row.value ?? ''),
        enabled: row.enabled !== false,
        ...(HTTP_KV_OPS.includes(row.op as HttpKvOp)
          ? { op: row.op as HttpKvOp }
          : {}),
        ...(typeof row.valueFrom === 'string' ? { valueFrom: row.valueFrom } : {}),
        ...(typeof row.keyFrom === 'string' ? { keyFrom: row.keyFrom } : {}),
      }))
      .filter((row) => row.key.length > 0 || typeof row.keyFrom === 'string');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => ({
        key,
        value: String(entry ?? ''),
        enabled: true,
      }),
    );
  }
  return [];
}

export function parseHttpRequest(input: unknown): HttpRequestDef {
  return httpRequestSchema.parse(coerceHttpRequest(input));
}
