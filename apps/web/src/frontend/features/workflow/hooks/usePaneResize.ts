/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A pane size in pixels, changed by dragging a separator or with its arrow keys.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const KEY_STEP = 16;

export function usePaneResize({
  initial,
  min,
  max,
  axis,
  invert = false,
}: {
  initial: number;
  min: number;
  max: number;
  /** `x` for a side pane, `y` for a pane above or below. */
  axis: 'x' | 'y';
  /** The pane sits after its separator (right or below), so dragging towards it shrinks it. */
  invert?: boolean;
}) {
  const [size, setSize] = useState(initial);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const start = axis === 'x' ? event.clientX : event.clientY;
      const startSize = sizeRef.current;
      handle.setPointerCapture(event.pointerId);
      const move = (e: globalThis.PointerEvent) => {
        const delta = (axis === 'x' ? e.clientX : e.clientY) - start;
        setSize(clamp(startSize + (invert ? -delta : delta)));
      };
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    },
    [axis, clamp, invert],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      if (event.key !== grow && event.key !== shrink) return;
      event.preventDefault();
      const direction = (event.key === grow ? 1 : -1) * (invert ? -1 : 1);
      setSize((current) => clamp(current + direction * KEY_STEP));
    },
    [axis, clamp, invert],
  );

  /** Spread onto the separator element. */
  const separatorProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
    'aria-valuenow': size,
    'aria-valuemin': min,
    'aria-valuemax': max,
    onPointerDown,
    onKeyDown,
  } as const;

  return { size, separatorProps };
}
