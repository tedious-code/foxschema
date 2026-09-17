/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The lokee-weave feature's public surface.
 *
 * Everything else under this folder is internal, so the layout can change
 * without touching a consumer. `LokeeWeaveView` is the only entry the app
 * shell needs — history/compare and capture API are deep-imported where used.
 */
export { LokeeWeaveView } from './components/LokeeWeaveView';
