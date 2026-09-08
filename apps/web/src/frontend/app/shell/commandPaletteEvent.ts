/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The palette listens for this event so the TopBar ⌘K button and the
 * keyboard shortcut share one opener.
 *
 * Named `commandPaletteEvent`, not `commandPalette`, because a sibling module
 * is `CommandPalette.tsx`. On a case-insensitive filesystem — macOS, which is
 * the usual dev machine here — `./commandPalette` and `./CommandPalette`
 * resolve to the same path, and the resolver picked this file for both: the
 * component came back `undefined` and every test rendering it failed with
 * "Element type is invalid". Linux CI resolves exactly and stayed green, so
 * the breakage only ever showed up locally.
 */
export const COMMAND_PALETTE_EVENT = 'foxschema-command-palette';

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(COMMAND_PALETTE_EVENT));
}
