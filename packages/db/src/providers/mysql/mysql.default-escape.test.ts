/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * MySQL reports a string default as a bare value, so the provider has to build
 * the literal. Both escapes matter, and only one of them used to be handled.
 */
import { describe, expect, it } from 'vitest';
import { normalizeDefault } from './mysql.provider.js';

describe('normalizeDefault (MySQL string literals)', () => {
  it('escapes a backslash, which MySQL would otherwise consume', () => {
    // Verified against MySQL 8: emitting `'C:\path\name'` stored `C:path` plus a
    // newline — the migrated column silently got a different default from the
    // source. Round-tripped through the provider it now comes back identical.
    expect(normalizeDefault('varchar(50)', 'C:\\path\\name')).toBe("'C:\\\\path\\\\name'");
  });

  it('still doubles the apostrophe', () => {
    expect(normalizeDefault('varchar(20)', "O'Brien")).toBe("'O''Brien'");
  });

  it('escapes both together, backslash first', () => {
    // Quote-first would escape the backslash this pass adds.
    expect(normalizeDefault('varchar(20)', "a\\'b")).toBe("'a\\\\''b'");
  });

  it('leaves non-string defaults alone', () => {
    expect(normalizeDefault('int', '42')).toBe('42');
    expect(normalizeDefault('timestamp', 'CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(normalizeDefault('varchar(10)', null)).toBeUndefined();
  });

  it('does not re-quote something already quoted', () => {
    expect(normalizeDefault('varchar(10)', "'done'")).toBe("'done'");
  });
});
