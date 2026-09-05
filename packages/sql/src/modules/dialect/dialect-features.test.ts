/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The table's own rules. Whether it *agrees* with the features it summarises
 * is `dialect-features.consistency.test.ts`, which lives outside `modules/`
 * because this domain is a foundation and may not import the others.
 */
import { describe, expect, it } from 'vitest';
import {
  DIALECT_FEATURES,
  dialectFeatureReason,
  dialectFeatures,
  knownDialects,
  supportsDialectFeature,
} from './dialect-features.js';

describe('every known engine answers for every feature', () => {
  it('returns a support record with no gaps', () => {
    for (const dialect of knownDialects()) {
      const features = dialectFeatures(dialect);
      for (const feature of DIALECT_FEATURES) {
        expect(typeof features[feature]?.supported, `${dialect}.${feature}`).toBe('boolean');
      }
    }
  });

  it('gives a reason whenever it says no', () => {
    // A disabled control with no explanation is the thing this replaces.
    for (const dialect of knownDialects()) {
      const features = dialectFeatures(dialect);
      for (const feature of DIALECT_FEATURES) {
        if (!features[feature].supported) {
          expect(features[feature].reason, `${dialect}.${feature}`).toBeTruthy();
        }
      }
    }
  });

  it('gives no reason when it says yes', () => {
    // Otherwise a caller rendering `reason` unconditionally shows a note under
    // a feature that works.
    expect(dialectFeatureReason('postgres', 'schemaCompare')).toBeUndefined();
    expect(dialectFeatures('postgres').schemaCompare).toEqual({ supported: true });
  });
});

describe('an engine nobody added supports nothing', () => {
  // The safe direction, and the opposite of `resolveDialect`, which answers
  // Db2 for an unknown name. That default is why a Redis connection could
  // reach Schema Compare and get Db2 DDL.
  it('refuses every feature', () => {
    for (const feature of DIALECT_FEATURES) {
      expect(supportsDialectFeature('dynamodb', feature), feature).toBe(false);
    }
  });

  it('names the engine in the reason', () => {
    expect(dialectFeatureReason('dynamodb', 'schemaCompare')).toMatch(/dynamodb/);
  });

  it('does not crash on an empty or odd name', () => {
    expect(supportsDialectFeature('', 'dbAccess')).toBe(false);
    expect(dialectFeatureReason('', 'dbAccess')).toMatch(/this engine/i);
  });
});

describe('the engines whose answers this was built to fix', () => {
  it('keeps Redis and MongoDB out of schema compare', () => {
    for (const dialect of ['redis', 'mongodb']) {
      expect(supportsDialectFeature(dialect, 'schemaCompare'), dialect).toBe(false);
      expect(supportsDialectFeature(dialect, 'commandMode'), dialect).toBe(false);
    }
  });

  it('leaves Redis and MongoDB their row editing, which does work', () => {
    // Both adapters support writes — MongoDB through executeDataMigrateOps —
    // so switching everything off for a non-SQL engine would be as wrong as
    // leaving everything on.
    for (const dialect of ['redis', 'mongodb']) {
      expect(supportsDialectFeature(dialect, 'rowEditing'), dialect).toBe(true);
    }
  });

  it('blames Fox Schema for ClickHouse access, not ClickHouse', () => {
    // `GRANT SELECT ON default.* TO user` was accepted by a live ClickHouse
    // server. What is missing is the builder.
    const reason = dialectFeatureReason('clickhouse', 'dbAccess')!;
    expect(reason).toMatch(/Fox Schema/);
    expect(reason).not.toMatch(/ClickHouse has no/i);
  });

  it('does blame the engine where the engine really is the reason', () => {
    expect(dialectFeatureReason('sqlite', 'userManagement')).toMatch(/SQLite has no/);
  });
});
