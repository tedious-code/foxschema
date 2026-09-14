/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/pipes/families.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  AUTH_METHOD_FIELDS,
  AUTH_METHOD_SHAPE,
} from '../auth/methods.js';
import {
  AUTH_METHODS,
  PIPE_FAMILIES,
  PIPE_FAMILY_LABELS,
  authMethodSchema,
  pipeFamilySchema,
} from './families.js';

describe('pipe families', () => {
  it('covers every family with a human label', () => {
    for (const family of PIPE_FAMILIES) {
      expect(pipeFamilySchema.parse(family)).toBe(family);
      expect(PIPE_FAMILY_LABELS[family].length).toBeGreaterThan(0);
    }
  });

  it('documents fields and runtime shape for every auth method', () => {
    for (const method of AUTH_METHODS) {
      expect(authMethodSchema.parse(method)).toBe(method);
      expect(AUTH_METHOD_FIELDS[method].length).toBeGreaterThan(0);
      expect(AUTH_METHOD_SHAPE[method].credentialKinds.length).toBeGreaterThan(
        0,
      );
      expect(AUTH_METHOD_SHAPE[method].note.length).toBeGreaterThan(0);
    }
  });

  it('routes oauth and otp through prompt-friendly shapes', () => {
    expect(AUTH_METHOD_SHAPE.oauth.credentialKinds[0]).toBe('oauth');
    expect(AUTH_METHOD_SHAPE.otp.promptWhenMissing).toContain('sms');
    expect(AUTH_METHOD_SHAPE.otp.promptWhenMissing).toContain('webpage');
  });
});
