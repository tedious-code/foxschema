/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A popover stays wholly on screen wherever its trigger sits.
 */
import { describe, expect, it } from 'vitest';
import { placePopover } from './useAnchoredPopover';

const VIEWPORT = { width: 1024, height: 768 };
const MENU = { width: 256, height: 300 };

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('placePopover', () => {
  it('opens below the trigger, left edges aligned, when there is room', () => {
    expect(placePopover(rect(100, 40, 120, 24), MENU, VIEWPORT)).toEqual({ top: 70, left: 100 });
  });

  it('opens above a trigger too near the bottom', () => {
    expect(placePopover(rect(100, 700, 120, 24), MENU, VIEWPORT)).toEqual({ top: 394, left: 100 });
  });

  it('pulls a popover back from the right edge', () => {
    expect(placePopover(rect(980, 40, 40, 24), MENU, VIEWPORT).left).toBe(1024 - 256 - 8);
  });

  it('opens beside a trigger at the foot of a left rail, upward, on screen', () => {
    // The account avatar: 40px wide, at the bottom of the rail.
    const placed = placePopover(rect(8, 720, 40, 40), MENU, VIEWPORT, 'right');
    expect(placed).toEqual({ top: 460, left: 54 });
  });

  it('opens beside and below the top of a rail trigger when it fits', () => {
    expect(placePopover(rect(8, 100, 40, 40), MENU, VIEWPORT, 'right')).toEqual({ top: 100, left: 54 });
  });

  it('pins a popover taller than the viewport to the top margin', () => {
    expect(placePopover(rect(100, 40, 120, 24), { width: 256, height: 900 }, VIEWPORT).top).toBe(8);
  });
});
