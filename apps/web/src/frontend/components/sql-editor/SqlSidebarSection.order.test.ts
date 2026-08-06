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
  it('moves Schema to the front while keeping other relative order', () => {
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

  it('allows dragging Schema like any other section', () => {
    const order: SidebarSectionId[] = [
      'schema',
      'destinations',
      'bookmarks',
      'utilities',
    ];
    expect(moveSidebarSection(order, 0, 2)).toEqual([
      'destinations',
      'bookmarks',
      'schema',
      'utilities',
    ]);
    expect(moveSidebarSection(order, 2, 0)).toEqual([
      'bookmarks',
      'schema',
      'destinations',
      'utilities',
    ]);
  });
});
