/**
 * Thin re-export facade over `@foxschema/sql` for the Database Access
 * Assistant. Frontend code imports from here, never from `@foxschema/db`.
 */
export {
  ACCESS_PERMISSIONS,
  ACCESS_PRESETS,
  PERMISSION_DESCRIPTORS,
  PERMISSION_RISK,
  accessCapabilities,
  accessFamily,
  availablePermissions,
  buildAccessSql,
  describePermission,
  highestRisk,
  invertAccessRequest,
  permissionsForPreset,
  presetForPermissions,
  supportsAccessBuilder,
  type AccessCapabilities,
  type AccessPermission,
  type AccessPreset,
  type AccessPrincipal,
  type AccessScope,
  type AccessWarningLevel,
  type GeneratedPermissionSql,
  type GeneratedStatement,
  type PermissionDescriptor,
  type PermissionRequest,
  type PermissionRisk,
  type PermissionWarning,
} from '@foxschema/sql';
