/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Layout preferences for the History filter sidebar: which order the filter
 * sections sit in, and how wide the column is.
 *
 * Deliberately a second, smaller copy of what the SQL editor's sidebar does
 * rather than a shared abstraction over both. The two sidebars share a shape,
 * not a lifetime: this one has five fixed filter panels and no collapse or
 * per-section height, and the standing rule in this repo is to prefer the
 * duplicate over the premature layer. If a third sidebar appears, that is the
 * moment to merge them.
 *
 * Both preferences live in localStorage, per browser. Nothing here is sent to
 * the server — it is a layout choice, not account state.
 */

export type HistorySidebarSectionId =
  | 'objectType'
  | 'objectStatus'
  | 'version'
  | 'date'
  | 'user';

const ORDER_KEY = 'foxschema-history-sidebar-order';
const WIDTH_KEY = 'foxschema-history-sidebar-width';

/**
 * Object type first: it is the control that decides what the graph is *made
 * of*, so every other filter reads as a narrowing of it. Status is the legend,
 * and belongs next to what it colours.
 */
export const DEFAULT_HISTORY_SIDEBAR_ORDER: readonly HistorySidebarSectionId[] = [
  'objectType',
  'objectStatus',
  'version',
  'date',
  'user',
];

const ALL_IDS = new Set<HistorySidebarSectionId>(DEFAULT_HISTORY_SIDEBAR_ORDER);

export const MIN_HISTORY_SIDEBAR_WIDTH = 170;
export const MAX_HISTORY_SIDEBAR_WIDTH = 460;
export const DEFAULT_HISTORY_SIDEBAR_WIDTH = 220;

export function clampHistorySidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_HISTORY_SIDEBAR_WIDTH;
  return Math.min(MAX_HISTORY_SIDEBAR_WIDTH, Math.max(MIN_HISTORY_SIDEBAR_WIDTH, Math.round(width)));
}

/**
 * A stored order is a hint, not a contract: it can be stale (a section renamed
 * or removed since it was written), hand-edited, or from a newer build. Keep
 * what still exists, drop what does not, and append anything missing so a new
 * section appears instead of silently never rendering.
 */
export function normalizeHistorySidebarOrder(raw: unknown): HistorySidebarSectionId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_HISTORY_SIDEBAR_ORDER];
  const seen = new Set<HistorySidebarSectionId>();
  const order: HistorySidebarSectionId[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !ALL_IDS.has(id as HistorySidebarSectionId)) continue;
    const sid = id as HistorySidebarSectionId;
    if (seen.has(sid)) continue;
    seen.add(sid);
    order.push(sid);
  }
  for (const id of DEFAULT_HISTORY_SIDEBAR_ORDER) if (!seen.has(id)) order.push(id);
  return order;
}

/** Reorder (immutable). Out-of-range indexes are a no-op, not a throw. */
export function moveHistorySidebarSection(
  order: readonly HistorySidebarSectionId[],
  fromIndex: number,
  toIndex: number
): HistorySidebarSectionId[] {
  if (fromIndex === toIndex) return [...order];
  if (fromIndex < 0 || toIndex < 0) return [...order];
  if (fromIndex >= order.length || toIndex >= order.length) return [...order];
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

export function loadHistorySidebarOrder(): HistorySidebarSectionId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_HISTORY_SIDEBAR_ORDER];
    return normalizeHistorySidebarOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_HISTORY_SIDEBAR_ORDER];
  }
}

export function saveHistorySidebarOrder(order: readonly HistorySidebarSectionId[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode or quota — the layout just does not persist */
  }
}

export function loadHistorySidebarWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return DEFAULT_HISTORY_SIDEBAR_WIDTH;
    return clampHistorySidebarWidth(Number(raw));
  } catch {
    return DEFAULT_HISTORY_SIDEBAR_WIDTH;
  }
}

export function saveHistorySidebarWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(clampHistorySidebarWidth(width)));
  } catch {
    /* ignore */
  }
}
