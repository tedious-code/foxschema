/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { migrateUiPersist } from './uiStore';

describe('migrateUiPersist', () => {
  it('moves the old History pane onto the Snapshots workspace', () => {
    const next = migrateUiPersist(
      { activeView: 'sync', syncPane: 'history', lokeeEpoch: 3 },
      1
    ) as { activeView: string; syncPane: string; lokeeEpoch: number };
    expect(next.activeView).toBe('snapshots');
    expect(next.syncPane).toBe('compare');
    expect(next.lokeeEpoch).toBe(3);
  });

  it('rewrites the standalone lokeeWeave view the same way', () => {
    const next = migrateUiPersist({ activeView: 'lokeeWeave' }, 0) as {
      activeView: string;
      syncPane: string;
    };
    expect(next.activeView).toBe('snapshots');
    expect(next.syncPane).toBe('compare');
  });

  it('leaves Compare and Browse on Schema Sync', () => {
    const compare = migrateUiPersist({ activeView: 'sync', syncPane: 'compare' }, 2) as {
      activeView: string;
      syncPane: string;
    };
    expect(compare).toMatchObject({ activeView: 'sync', syncPane: 'compare' });
    const browse = migrateUiPersist({ activeView: 'sync', syncPane: 'browse' }, 2) as {
      activeView: string;
      syncPane: string;
    };
    expect(browse).toMatchObject({ activeView: 'sync', syncPane: 'browse' });
  });
});
