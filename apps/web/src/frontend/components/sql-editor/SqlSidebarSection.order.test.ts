/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  moveSidebarSection,
  pinSchemaFirst,
  type SidebarSectionId,
} from './SqlSidebarSection';

describe('SQL Editor sidebar order', () => {
  it('pins Schema first', () => {
    const order: SidebarSectionId[] = [
      'destinations',
      'bookmarks',
      'schema',
      'utilities',
    ];
    expect(pinSchemaFirst(order)).toEqual([
      'schema',
      'destinations',
      'bookmarks',
      'utilities',
    ]);
  });

  it('keeps Schema fixed when reordering other sections', () => {
    const order: SidebarSectionId[] = [
      'schema',
      'destinations',
      'bookmarks',
      'utilities',
    ];
    // Move bookmarks above destinations (indices 2 → 1).
    expect(moveSidebarSection(order, 2, 1)).toEqual([
      'schema',
      'bookmarks',
      'destinations',
      'utilities',
    ]);
  });

  it('ignores drags that try to move Schema', () => {
    const order: SidebarSectionId[] = [
      'schema',
      'destinations',
      'bookmarks',
    ];
    expect(moveSidebarSection(order, 0, 2)).toEqual(order);
    expect(moveSidebarSection(order, 2, 0)).toEqual(order);
  });
});
