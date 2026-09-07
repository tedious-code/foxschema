/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The palette listens for this event so the TopBar ⌘K button and the
 * keyboard shortcut share one opener.
 */
export const COMMAND_PALETTE_EVENT = 'foxschema-command-palette';

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(COMMAND_PALETTE_EVENT));
}
