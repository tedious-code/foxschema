/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  detectTriggerManagedColumns,
  isLikelyTriggerManagedColumn,
} from './triggerManagedColumns';

describe('isLikelyTriggerManagedColumn', () => {
  it.each([
    'createdAt',
    'created_at',
    'CreatedBy',
    'updatedAt',
    'updated_by',
    'UPDATEDBY',
    'modifiedOn',
    'last_modified',
    'lastModifiedBy',
    'rowversion',
    'xmin',
  ])('detects %s', (name) => {
    expect(isLikelyTriggerManagedColumn(name)).toBe(true);
  });

  it.each([
    'id',
    'name',
    'city',
    'create_order',
    'update_count',
    'status',
    // Bare names are often business columns — must not skip under migrate.
    'created',
    'updated',
    'modified',
  ])('does not flag %s', (name) => {
    expect(isLikelyTriggerManagedColumn(name)).toBe(false);
  });
});

describe('detectTriggerManagedColumns', () => {
  it('returns matching names from a column list', () => {
    expect(
      detectTriggerManagedColumns(['id', 'name', 'createdAt', 'updatedBy', 'city'])
    ).toEqual(['createdAt', 'updatedBy']);
  });
});
