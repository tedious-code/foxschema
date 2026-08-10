/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * jsdom setup for the `web-ui` vitest project.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount between tests: Testing Library renders into document.body, and a
// leaked tree makes the next test's queries ambiguous rather than failing
// outright, which is a miserable thing to debug.
afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and components that measure or observe
// layout throw on mount without them.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as unknown as typeof globalThis.matchMedia;

// Element.scrollTo is unimplemented in jsdom; grids call it on mount.
Element.prototype.scrollTo ??= function scrollTo(): void {};
