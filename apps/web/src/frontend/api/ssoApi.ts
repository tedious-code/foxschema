import { getApiBase } from './apiBase';

export type SsoProviderId = 'google' | 'microsoft' | 'github';

export interface SsoProvider {
  id: SsoProviderId;
  label: string;
}

/** Configured SSO providers (empty if none are set up on the server). */
export async function fetchSsoProviders(): Promise<SsoProvider[]> {
  try {
    const res = await fetch(`${getApiBase()}/auth/sso/providers`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = (await res.json()) as { providers?: SsoProvider[] };
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    return [];
  }
}

/** Full-page redirect into the provider's OAuth flow (returns to the app on success). */
export function startSso(id: SsoProviderId): void {
  window.location.href = `${getApiBase()}/auth/sso/${id}/start`;
}
