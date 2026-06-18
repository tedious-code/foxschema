import { resolveEdition, getCapabilities, type Edition, type Capabilities } from '@foxschema/shared';

// Build-time edition for the frontend. The desktop build leaves this unset
// (→ 'community'); the hosted web build sets VITE_EDITION=premium|enterprise.
// Resolves from the SAME capability map the backend uses, so the two agree.
export const EDITION: Edition = resolveEdition(import.meta.env.VITE_EDITION);
export const CAPABILITIES: Capabilities = getCapabilities(EDITION);

/** Convenience guard for capability-based UI gating. */
export function can<K extends keyof Capabilities>(feature: K): Capabilities[K] {
  return CAPABILITIES[feature];
}
