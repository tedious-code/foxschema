/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The feature table must agree with the features themselves.
 *
 * `dialect-features.ts` is a declaration, not a derivation: `dialect` is a
 * foundation domain and `architecture.test.ts` forbids it from importing
 * `access` or `command-mode`. A declaration can drift from what it describes,
 * and the drift would be invisible — a tab offered for an engine that then
 * refuses every action, or hidden for one that would have worked.
 *
 * This file lives outside `modules/` precisely so it may import both sides.
 * It compares the booleans only. The wording is deliberately different: the
 * table explains a missing tab, each feature explains a refused request.
 */
import { describe, expect, it } from 'vitest';
import {
  DIALECT_FEATURES,
  dialectFeatures,
  knownDialects,
  supportsDialectFeature,
} from './modules/dialect/dialect-features.js';
import { DIALECT_MAP, resolveDialect } from './modules/dialect/registry.js';
import { supportsAccessBuilder } from './modules/access/intent.js';
import { userManagementSupport } from './modules/access/user-sql.js';
import { supportsCommandMode } from './modules/command-mode/cli.registry.js';

describe('the table agrees with the features it summarises', () => {
  it('matches supportsAccessBuilder for every engine', () => {
    for (const dialect of knownDialects()) {
      expect(supportsDialectFeature(dialect, 'dbAccess'), dialect).toBe(
        supportsAccessBuilder(dialect)
      );
    }
  });

  it('matches userManagementSupport for every engine', () => {
    for (const dialect of knownDialects()) {
      expect(supportsDialectFeature(dialect, 'userManagement'), dialect).toBe(
        userManagementSupport(dialect).supported
      );
    }
  });

  it('matches supportsCommandMode for every engine', () => {
    for (const dialect of knownDialects()) {
      expect(supportsDialectFeature(dialect, 'commandMode'), dialect).toBe(
        supportsCommandMode(dialect)
      );
    }
  });

  it('offers schema compare exactly to the engines that have a SQL dialect', () => {
    // This is the gate that did not exist. `resolveDialect` answers Db2 for a
    // name it does not know, so without it a Redis connection reaching compare
    // produced Db2 DDL and nothing said otherwise.
    const withDialect = new Set(Object.keys(DIALECT_MAP).map((d) => d.toLowerCase()));
    for (const dialect of knownDialects()) {
      expect(supportsDialectFeature(dialect, 'schemaCompare'), dialect).toBe(
        withDialect.has(dialect)
      );
    }
  });

  it('knows every engine that has a SQL dialect', () => {
    // A dialect added to the registry but not here would be treated as
    // unknown and lose every feature, which is safe but wrong.
    for (const dialect of Object.keys(DIALECT_MAP)) {
      expect(knownDialects(), dialect).toContain(dialect.toLowerCase());
    }
  });
});

describe('the unknown engine is the safe one', () => {
  it('supports nothing, with a reason for each', () => {
    const features = dialectFeatures('some-engine-nobody-added');
    for (const feature of DIALECT_FEATURES) {
      expect(features[feature].supported, feature).toBe(false);
      expect(features[feature].reason, feature).toBeTruthy();
    }
  });

  it('refuses schema compare even though resolveDialect would answer', () => {
    // The fallback itself is unchanged — callers that already reached it keep
    // working. What changes is that a caller can now ask first.
    expect(resolveDialect('dynamodb')).toBe(DIALECT_MAP.DB2);
    expect(supportsDialectFeature('dynamodb', 'schemaCompare')).toBe(false);
  });

  it('treats an empty dialect as unknown rather than defaulting', () => {
    expect(supportsDialectFeature('', 'schemaCompare')).toBe(false);
  });
});
