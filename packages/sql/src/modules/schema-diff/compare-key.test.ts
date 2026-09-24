/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { bareObjectName, compareKey } from './compare-key.js';

describe('compareKey', () => {
  it('matches an object regardless of schema, quoting or case', () => {
    for (const name of ['HUY.MyTable', '"YOU".MyTable', '"YOU"."MyTable"', 'MyTable', 'mytable']) {
      expect(compareKey(name)).toBe('MYTABLE');
    }
  });

  it('keeps case in the bare name', () => {
    expect(bareObjectName('"sales"."Orders"')).toBe('Orders');
  });

  it('pins the documented limits so a change to them is deliberate', () => {
    expect(compareKey('db.sch.t')).toBe('SCH.T');
    expect(compareKey('[dbo].[t]')).toBe('[T]');
  });
});
