/**
 * Fox Schema (@foxschema/db)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { requireDriver } from './driver-loader.js';

describe('requireDriver', () => {
  it('turns a missing driver into an install hint naming the package and dialect', () => {
    expect(() => requireDriver('foxschema-no-such-driver', 'postgres')).toThrow(
      /^Database driver "foxschema-no-such-driver" is not installed for postgres\. Install it with: npm install foxschema-no-such-driver — /
    );
  });

  it('adds install flags to the hint', () => {
    expect(() =>
      requireDriver('foxschema-no-such-driver', 'db2', { installFlags: '--foreground-scripts' })
    ).toThrow(/npm install foxschema-no-such-driver --foreground-scripts — /);
  });

  it('loads a module by a different specifier than the package it names', () => {
    // mysql2 is loaded as mysql2/promise; any resolvable subpath shows the shape.
    const mod = requireDriver('node:path', 'test', { specifier: 'node:path/posix' });
    expect(typeof mod.join).toBe('function');
  });

  it('unwraps a default export unless told not to', () => {
    const unwrapped = requireDriver('node:path', 'test');
    const raw = requireDriver('node:path', 'test', { unwrapDefault: false });
    expect(unwrapped).toBe(raw.default ?? raw);
  });
});
