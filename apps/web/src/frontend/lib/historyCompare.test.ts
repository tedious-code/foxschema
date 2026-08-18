/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  historyVersionLabel,
  lokeeDatabaseLabel,
  resolveHistoryCompare,
  swapHistoryCompare,
} from './historyCompare';

const v1 = { id: 'v1', number: 1, name: 'Initial' };
const v2 = { id: 'v2', number: 2 };
const v3 = { id: 'v3', number: 3, name: 'After migrate' };

describe('resolveHistoryCompare', () => {
  it('returns empty sides when there are no versions', () => {
    const resolved = resolveHistoryCompare([], { originalVersionId: null, targetVersionId: null });
    expect(resolved.original).toBeNull();
    expect(resolved.target).toBeNull();
    expect(resolved.targetIsCurrent).toBe(true);
  });

  it('uses the only version as both Original and current Target', () => {
    const resolved = resolveHistoryCompare([v1], { originalVersionId: null, targetVersionId: null });
    expect(resolved.original).toEqual(v1);
    expect(resolved.target).toEqual(v1);
    expect(resolved.targetIsCurrent).toBe(true);
  });

  it('defaults Original to the previous version and Target to current', () => {
    const resolved = resolveHistoryCompare([v1, v3, v2], {
      originalVersionId: null,
      targetVersionId: null,
    });
    expect(resolved.latest?.id).toBe('v3');
    expect(resolved.original?.id).toBe('v2');
    expect(resolved.target?.id).toBe('v3');
    expect(resolved.targetIsCurrent).toBe(true);
  });

  it('honours an explicit Original and an older Target', () => {
    const resolved = resolveHistoryCompare([v1, v2, v3], {
      originalVersionId: 'v3',
      targetVersionId: 'v1',
    });
    expect(resolved.original?.id).toBe('v3');
    expect(resolved.target?.id).toBe('v1');
    expect(resolved.targetIsCurrent).toBe(false);
  });

  it('falls back when stored ids are stale', () => {
    const resolved = resolveHistoryCompare([v1, v2], {
      originalVersionId: 'gone',
      targetVersionId: 'also-gone',
    });
    expect(resolved.original?.id).toBe('v1');
    expect(resolved.target?.id).toBe('v2');
    expect(resolved.targetIsCurrent).toBe(true);
  });
});

describe('swapHistoryCompare', () => {
  it('is a no-op when both sides resolve to the same version', () => {
    const selection = { originalVersionId: null, targetVersionId: null };
    expect(swapHistoryCompare([v1], selection)).toEqual(selection);
  });

  it('swaps previous → current into current → older version', () => {
    const swapped = swapHistoryCompare([v1, v2], {
      originalVersionId: null,
      targetVersionId: null,
    });
    expect(swapped.originalVersionId).toBe('v2');
    expect(swapped.targetVersionId).toBe('v1');
  });

  it('marks Target as current when the swapped-in version is latest', () => {
    const swapped = swapHistoryCompare([v1, v2], {
      originalVersionId: 'v2',
      targetVersionId: 'v1',
    });
    expect(swapped.originalVersionId).toBe('v1');
    expect(swapped.targetVersionId).toBeNull();
  });
});

describe('labels', () => {
  it('labels the latest snapshot as the current database', () => {
    expect(historyVersionLabel(v3, { current: true })).toBe(
      'Current database (v3 · After migrate)'
    );
    expect(historyVersionLabel(v2)).toBe('Version 2');
  });

  it('names a history database the same way the picker does', () => {
    expect(
      lokeeDatabaseLabel({
        id: 'db1',
        dialect: 'postgres',
        host: 'localhost',
        database: 'foxdb',
        schema: 'public',
        versionCount: 3,
      })
    ).toBe('POSTGRES · localhost/foxdb · public (3 v)');
  });
});

describe('compare-only labelling', () => {
  // A revert restores the live database from the newest version. Two picks can
  // be compared but never reverted, and both used to look exactly like every
  // other option until Execute greyed out with the reason in a tooltip.
  const v = { id: 'v7', number: 7 };

  it('marks the newest version when it sits on the Original side', () => {
    expect(historyVersionLabel(v, { compareOnly: 'is-current' })).toBe(
      'Version 7 — current, nothing to restore'
    );
  });

  it('marks an older version chosen as Target', () => {
    expect(historyVersionLabel(v, { compareOnly: 'not-current' })).toBe('Version 7 — compare only');
  });

  it('leaves an ordinary choice unmarked', () => {
    expect(historyVersionLabel(v)).toBe('Version 7');
  });

  it('keeps the current-database wording, which outranks the marker', () => {
    expect(historyVersionLabel(v, { current: true, compareOnly: 'not-current' })).toBe(
      'Current database (Version 7)'
    );
  });

  it('keeps a custom version name in a marked label', () => {
    expect(
      historyVersionLabel({ id: 'v7', number: 7, name: 'before launch' }, { compareOnly: 'not-current' })
    ).toBe('v7 · before launch — compare only');
  });
});
