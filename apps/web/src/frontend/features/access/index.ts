/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Access feature's public surface.
 *
 * Everything else under `features/access/` is internal, so the layout can
 * change without touching a consumer. `AccessView` is the only entry the app
 * shell needs; the inspector, builder and user management are exported because
 * the report and future callers compose them, not because anything outside uses
 * them today — if that stays true they should come back out.
 */
export { UserManagement } from './components/UserManagement';
export { AccessView } from './components/AccessView';
export { PermissionInspector } from './components/PermissionInspector';
export { PermissionBuilder } from './components/PermissionBuilder';
export { AccessReport } from './components/AccessReport';

export {
  describePermission,
  resolveEffectiveAccess,
  type AccessPermission,
  type EffectiveAccess,
} from './lib/access';
