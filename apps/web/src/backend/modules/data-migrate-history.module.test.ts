/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  DATA_MIGRATE_MAX_TEXT_LEN,
  storeableSnapshotJson,
} from './data-migrate-history.module';

describe('storeableSnapshotJson', () => {
  it('stores intact JSON under the size limit', () => {
    const json = JSON.stringify({ version: 1, rows: [], columns: ['id'] });
    expect(storeableSnapshotJson(json)).toEqual({ json, stored: true });
  });

  it('omits oversized snapshots instead of appending a truncation marker', () => {
    const json = `${'{"rows":['}${'1,'.repeat(DATA_MIGRATE_MAX_TEXT_LEN)}]`;
    expect(json.length).toBeGreaterThan(DATA_MIGRATE_MAX_TEXT_LEN);
    expect(storeableSnapshotJson(json)).toEqual({ json: undefined, stored: false });
  });

  it('rejects non-JSON so History never offers a corrupt Restore payload', () => {
    const truncated = `${JSON.stringify({ rows: [1], columns: ['id'] }).slice(0, 20)}\n… (truncated)`;
    expect(storeableSnapshotJson(truncated)).toEqual({ json: undefined, stored: false });
  });

  it('treats missing snapshot as not stored', () => {
    expect(storeableSnapshotJson(undefined)).toEqual({ json: undefined, stored: false });
  });
});
