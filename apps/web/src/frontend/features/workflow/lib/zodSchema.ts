/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (lib/zod-schema.ts).
 */
import { z as zod } from 'zod/v4';

/**
 * Compile designer-authored Zod code into an ajv-compatible JSON Schema
 * (draft-7). Accepts a bare expression (`z.object({...})`) or statements
 * ending in `return`. Runs only in the author's own browser — the server
 * stores and enforces the compiled JSON Schema, never the code.
 */
export function compileZodSchema(
  code: string,
): { schema: Record<string, unknown> } | { error: string } | null {
  if (!code.trim()) return null;
  try {
    let built: unknown;
    try {
      built = new Function('z', `"use strict"; return (${code});`)(zod);
    } catch {
      built = new Function('z', `"use strict"; ${code}`)(zod);
    }
    const schema = zod.toJSONSchema(built as never, {
      target: 'draft-7',
    }) as Record<string, unknown>;
    return { schema };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
