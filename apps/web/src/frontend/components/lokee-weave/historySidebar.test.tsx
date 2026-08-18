/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * `.tsx` despite holding no JSX: the vitest projects select the environment by
 * extension, and these need jsdom's `localStorage`.
 *
 * The rule these encode: a stored preference is a hint. It can be stale,
 * truncated, or hand-edited, and none of those may cost the user a filter
 * panel or leave the sidebar at an unusable width.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampHistorySidebarWidth,
  DEFAULT_HISTORY_SIDEBAR_ORDER,
  DEFAULT_HISTORY_SIDEBAR_WIDTH,
  loadHistorySidebarOrder,
  loadHistorySidebarWidth,
  MAX_HISTORY_SIDEBAR_WIDTH,
  MIN_HISTORY_SIDEBAR_WIDTH,
  moveHistorySidebarSection,
  normalizeHistorySidebarOrder,
  saveHistorySidebarOrder,
  saveHistorySidebarWidth,
  type HistorySidebarSectionId,
} from './historySidebar';

describe('default order', () => {
  it('leads with object type, then status', () => {
    // Object type decides what the graph is made of; status colours it.
    expect(DEFAULT_HISTORY_SIDEBAR_ORDER.slice(0, 2)).toEqual(['objectType', 'objectStatus']);
    expect(DEFAULT_HISTORY_SIDEBAR_ORDER).toEqual([
      'objectType',
      'objectStatus',
      'version',
      'date',
      'user',
    ]);
  });
});

describe('normalizeHistorySidebarOrder', () => {
  it('keeps a valid stored order as it is', () => {
    const stored: HistorySidebarSectionId[] = ['user', 'date', 'version', 'objectStatus', 'objectType'];
    expect(normalizeHistorySidebarOrder(stored)).toEqual(stored);
  });

  it('appends sections the stored order never heard of', () => {
    // What a user who saved their layout before "user" existed would have.
    expect(normalizeHistorySidebarOrder(['version', 'objectType'])).toEqual([
      'version',
      'objectType',
      'objectStatus',
      'date',
      'user',
    ]);
  });

  it('drops unknown ids and duplicates rather than rendering them', () => {
    expect(
      normalizeHistorySidebarOrder(['version', 'version', 'nope', 42, null, 'user'])
    ).toEqual(['version', 'user', 'objectType', 'objectStatus', 'date']);
  });

  it.each([[null], [undefined], ['not an array'], [{}], [7]])(
    'falls back to the default for %p',
    (raw) => {
      expect(normalizeHistorySidebarOrder(raw)).toEqual([...DEFAULT_HISTORY_SIDEBAR_ORDER]);
    }
  );
});

describe('moveHistorySidebarSection', () => {
  const order: HistorySidebarSectionId[] = ['objectType', 'objectStatus', 'version', 'date', 'user'];

  it('moves a section down', () => {
    expect(moveHistorySidebarSection(order, 0, 2)).toEqual([
      'objectStatus',
      'version',
      'objectType',
      'date',
      'user',
    ]);
  });

  it('moves a section up', () => {
    expect(moveHistorySidebarSection(order, 4, 0)).toEqual([
      'user',
      'objectType',
      'objectStatus',
      'version',
      'date',
    ]);
  });

  it('never loses or duplicates a section', () => {
    const moved = moveHistorySidebarSection(order, 3, 1);
    expect([...moved].sort()).toEqual([...order].sort());
  });

  it.each([
    [0, 0],
    [-1, 2],
    [2, -1],
    [9, 1],
    [1, 9],
  ])('is a no-op for out-of-range (%i → %i)', (from, to) => {
    expect(moveHistorySidebarSection(order, from, to)).toEqual(order);
  });

  it('does not mutate the input', () => {
    const input = [...order];
    moveHistorySidebarSection(input, 0, 3);
    expect(input).toEqual(order);
  });
});

describe('clampHistorySidebarWidth', () => {
  it.each([
    [0, MIN_HISTORY_SIDEBAR_WIDTH],
    [-500, MIN_HISTORY_SIDEBAR_WIDTH],
    [9999, MAX_HISTORY_SIDEBAR_WIDTH],
    [260, 260],
    [260.6, 261],
  ])('clamps %p to %p', (raw, want) => {
    expect(clampHistorySidebarWidth(raw)).toBe(want);
  });

  it.each([[NaN], [Infinity]])('falls back to the default for %p', (raw) => {
    expect(clampHistorySidebarWidth(raw)).toBe(DEFAULT_HISTORY_SIDEBAR_WIDTH);
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips an order', () => {
    const order: HistorySidebarSectionId[] = ['user', 'version', 'objectType', 'date', 'objectStatus'];
    saveHistorySidebarOrder(order);
    expect(loadHistorySidebarOrder()).toEqual(order);
  });

  it('round-trips a width, clamped on the way in and out', () => {
    saveHistorySidebarWidth(9999);
    expect(loadHistorySidebarWidth()).toBe(MAX_HISTORY_SIDEBAR_WIDTH);
  });

  it('returns the defaults when nothing is stored', () => {
    expect(loadHistorySidebarOrder()).toEqual([...DEFAULT_HISTORY_SIDEBAR_ORDER]);
    expect(loadHistorySidebarWidth()).toBe(DEFAULT_HISTORY_SIDEBAR_WIDTH);
  });

  it('survives corrupt storage rather than throwing on mount', () => {
    localStorage.setItem('foxschema-history-sidebar-order', '{not json');
    localStorage.setItem('foxschema-history-sidebar-width', 'wide please');
    expect(loadHistorySidebarOrder()).toEqual([...DEFAULT_HISTORY_SIDEBAR_ORDER]);
    expect(loadHistorySidebarWidth()).toBe(DEFAULT_HISTORY_SIDEBAR_WIDTH);
  });
});
