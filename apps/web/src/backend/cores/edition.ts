import { resolveEdition, getCapabilities, type Edition, type Capabilities } from '@foxschema/shared';

// Build/deploy-time edition selection. The hosted web app sets EDITION to
// 'premium' or 'enterprise'; the desktop sidecar leaves it as 'community'.
export const EDITION: Edition = resolveEdition(process.env.EDITION);
export const CAPABILITIES: Capabilities = getCapabilities(EDITION);
export const isCommunity = EDITION === 'community';

// Local single-user mode: no login/cookies — the desktop app is the trust
// boundary. On by default for the community desktop edition; can be forced on
// for local web dev with LOCAL_SINGLE_USER=true.
export const LOCAL_SINGLE_USER = isCommunity || process.env.LOCAL_SINGLE_USER === 'true';
