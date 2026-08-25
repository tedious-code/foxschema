/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The object-detail feature's public surface.
 *
 * Everything else under this folder is internal, so the layout can change
 * without touching a consumer. These are the symbols other parts of the app
 * actually import today — derived from usage, not guessed, so the surface
 * starts as small as it truly is.
 */
export { BrowseBar } from './components/BrowseBar';
export { ObjectDetailPanel } from './components/ObjectDetailPanel';
