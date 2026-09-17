/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Access feature's public surface.
 *
 * Everything else under `features/access/` is internal, so the layout can
 * change without touching a consumer. `AccessView` is the only entry the app
 * shell needs.
 */
export { AccessView } from './components/AccessView';
