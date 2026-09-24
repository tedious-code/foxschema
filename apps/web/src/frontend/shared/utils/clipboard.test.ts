/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboard } from './clipboard';

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

function stubClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

describe('writeClipboard', () => {
  it('reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    expect(await writeClipboard('x')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('x');
  });

  it('reports a refusal instead of throwing', async () => {
    stubClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    expect(await writeClipboard('x')).toBe(false);
  });
});
