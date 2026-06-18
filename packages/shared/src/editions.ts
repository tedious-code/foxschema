// Single source of truth for edition gating. Both the frontend (build-time
// VITE_EDITION) and the backend (process.env.EDITION) resolve their feature set
// from this one map, so the two can never drift. Editions are chosen at build
// time — there is no runtime license check.

export type Edition = 'community' | 'premium' | 'enterprise';

export type Dialect = 'postgres' | 'mysql' | 'db2';

export interface Capabilities {
  /** Database dialects this edition may connect to. */
  dialects: Dialect[];
  /** Persist connection profiles (encrypted). Community stores them locally. */
  savedConnections: boolean;
  /** Sync connections/settings to the hosted backend. */
  cloudSync: boolean;
  /** Share connections/comparisons with a team. */
  teamSharing: boolean;
  /** Single sign-on (SAML/OIDC). */
  sso: boolean;
  /** Tamper-evident audit log of comparisons and migrations. */
  auditLog: boolean;
  /** Multiple authenticated users on one backend (vs. local single-user). */
  multiUser: boolean;
  /** Max saved connections; -1 means unlimited. */
  maxSavedConnections: number;
}

const UNLIMITED = -1;

export const EDITIONS: Record<Edition, Capabilities> = {
  // Free desktop app: full dialect support, but local-only and single-user.
  community: {
    dialects: ['postgres', 'mysql', 'db2'],
    savedConnections: true,
    cloudSync: false,
    teamSharing: false,
    sso: false,
    auditLog: false,
    multiUser: false,
    maxSavedConnections: UNLIMITED,
  },
  // Hosted web app for individuals/small teams.
  premium: {
    dialects: ['postgres', 'mysql', 'db2'],
    savedConnections: true,
    cloudSync: true,
    teamSharing: false,
    sso: false,
    auditLog: false,
    multiUser: true,
    maxSavedConnections: UNLIMITED,
  },
  // Hosted web app with org controls.
  enterprise: {
    dialects: ['postgres', 'mysql', 'db2'],
    savedConnections: true,
    cloudSync: true,
    teamSharing: true,
    sso: true,
    auditLog: true,
    multiUser: true,
    maxSavedConnections: UNLIMITED,
  },
};

const EDITION_VALUES = Object.keys(EDITIONS) as Edition[];

export function isEdition(value: unknown): value is Edition {
  return typeof value === 'string' && (EDITION_VALUES as string[]).includes(value);
}

/** Resolve an edition from an env/flag string, defaulting to 'community'. */
export function resolveEdition(value: string | undefined | null): Edition {
  return isEdition(value) ? value : 'community';
}

export function getCapabilities(edition: Edition): Capabilities {
  return EDITIONS[edition];
}
