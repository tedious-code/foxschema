/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Where a popover opens, measured against the viewport rather than its parent.
 *
 * A popover positioned `absolute` inside its trigger's container is clipped by
 * any ancestor that scrolls. The SQL editor toolbar is `overflow-x-auto`, which
 * clips vertically too, so the destinations list opened into a 50px sliver. A
 * menu placed for one spot also breaks when its trigger moves: the account menu
 * opened below and right-aligned, which suited the top toolbar and put it off
 * the screen once the avatar moved to the foot of the left rail.
 *
 * So popovers render in a portal, `fixed`, and this places them from the
 * trigger's rectangle and the popover's measured size, flipping and clamping so
 * the whole popover stays on screen wherever the trigger is.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** Below the trigger, or beside it — for a trigger on a side rail. */
export type PopoverSide = 'bottom' | 'right';

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface Size {
  width: number;
  height: number;
}

const GAP = 6;
const MARGIN = 8;

/** Keep `size` inside `extent`, leaving the margin; pin to the start if it cannot fit. */
function clamp(value: number, size: number, extent: number): number {
  return Math.max(MARGIN, Math.min(value, extent - size - MARGIN));
}

export function placePopover(
  anchor: Rect,
  size: Size,
  viewport: Size,
  side: PopoverSide = 'bottom'
): { top: number; left: number } {
  if (side === 'right') {
    const after = anchor.right + GAP;
    const before = anchor.left - GAP - size.width;
    const left = after + size.width > viewport.width - MARGIN && before >= MARGIN ? before : after;
    // Top-aligned with the trigger unless that runs off the bottom; then
    // bottom-aligned, so a trigger at the foot of a rail opens upward beside it.
    const top =
      anchor.top + size.height > viewport.height - MARGIN ? anchor.bottom - size.height : anchor.top;
    return { top: clamp(top, size.height, viewport.height), left: clamp(left, size.width, viewport.width) };
  }
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  const top = below + size.height > viewport.height - MARGIN && above >= MARGIN ? above : below;
  return {
    top: clamp(top, size.height, viewport.height),
    left: clamp(anchor.left, size.width, viewport.width),
  };
}

/**
 * Refs for a trigger and its portaled popover, and the popover's `fixed` style.
 *
 * The popover renders hidden until measured, because its size decides where it
 * goes; it is re-placed on resize, on any scroll, and when its own size changes.
 */
export function useAnchoredPopover<A extends HTMLElement, P extends HTMLElement>(
  open: boolean,
  side: PopoverSide = 'bottom'
) {
  const anchorRef = useRef<A>(null);
  const popoverRef = useRef<P>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const next = placePopover(
        anchor.getBoundingClientRect(),
        { width: popover.offsetWidth, height: popover.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        side
      );
      setPosition((current) =>
        current && current.top === next.top && current.left === next.left ? current : next
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // A filter narrows the list and the popover shrinks; one opened upward has
    // to follow its trigger down rather than float above a gap.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, side]);

  const style: CSSProperties = position
    ? { position: 'fixed', top: position.top, left: position.left }
    : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

  return { anchorRef, popoverRef, style };
}
