import type { Request } from 'express';

/**
 * Config-driven SSO (OAuth2 / OIDC). Providers activate only when their client
 * id + secret env vars are set, so the buttons appear once an operator configures
 * them — no secrets in code. Users are linked/created by verified email.
 *
 *   Google     SSO_GOOGLE_CLIENT_ID     SSO_GOOGLE_CLIENT_SECRET
 *   Microsoft  SSO_MICROSOFT_CLIENT_ID  SSO_MICROSOFT_CLIENT_SECRET  [SSO_MICROSOFT_TENANT]
 *   GitHub     SSO_GITHUB_CLIENT_ID     SSO_GITHUB_CLIENT_SECRET
 *   Optional:  SSO_REDIRECT_BASE (e.g. https://app.example.com) — else derived from the request.
 */

export type SsoProviderId = 'google' | 'microsoft' | 'github';

export interface SsoProviderConfig {
  id: SsoProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  tenant?: string;
}

interface Endpoints {
  authorize: string;
  token: string;
  userinfo: string;
  scope: string;
}

function endpoints(p: SsoProviderConfig): Endpoints {
  switch (p.id) {
    case 'google':
      return {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile',
      };
    case 'microsoft': {
      const t = p.tenant || 'common';
      return {
        authorize: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
        token: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
        userinfo: 'https://graph.microsoft.com/oidc/userinfo',
        scope: 'openid email profile',
      };
    }
    case 'github':
      return {
        authorize: 'https://github.com/login/oauth/authorize',
        token: 'https://github.com/login/oauth/access_token',
        userinfo: 'https://api.github.com/user',
        scope: 'read:user user:email',
      };
  }
}

function fromEnv(
  id: SsoProviderId,
  label: string,
  idVar: string,
  secretVar: string,
  tenantVar?: string
): SsoProviderConfig | null {
  const clientId = process.env[idVar];
  const clientSecret = process.env[secretVar];
  if (!clientId || !clientSecret) return null;
  return { id, label, clientId, clientSecret, tenant: tenantVar ? process.env[tenantVar] || 'common' : undefined };
}

/** Providers that are currently configured (have client id + secret). */
export function configuredProviders(): SsoProviderConfig[] {
  return [
    fromEnv('google', 'Google', 'SSO_GOOGLE_CLIENT_ID', 'SSO_GOOGLE_CLIENT_SECRET'),
    fromEnv('microsoft', 'Microsoft', 'SSO_MICROSOFT_CLIENT_ID', 'SSO_MICROSOFT_CLIENT_SECRET', 'SSO_MICROSOFT_TENANT'),
    fromEnv('github', 'GitHub', 'SSO_GITHUB_CLIENT_ID', 'SSO_GITHUB_CLIENT_SECRET'),
  ].filter((p): p is SsoProviderConfig => p !== null);
}

export function getProvider(id: string): SsoProviderConfig | null {
  return configuredProviders().find((p) => p.id === id) ?? null;
}

export function redirectUri(req: Request, providerId: string): string {
  const base = process.env.SSO_REDIRECT_BASE || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/api/auth/sso/${providerId}/callback`;
}

export function authorizeUrl(p: SsoProviderConfig, redirect: string, state: string): string {
  const e = endpoints(p);
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: e.scope,
    state,
  });
  if (p.id === 'google') {
    params.set('access_type', 'online');
    params.set('prompt', 'select_account');
  }
  return `${e.authorize}?${params.toString()}`;
}

interface JsonRecord {
  [k: string]: unknown;
}

/** Exchange the auth code for a token, then return the verified email. */
export async function fetchVerifiedEmail(p: SsoProviderConfig, code: string, redirect: string): Promise<string> {
  const e = endpoints(p);
  const tokenRes = await fetch(e.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
  const tok = (await tokenRes.json()) as JsonRecord;
  const accessToken = tok.access_token as string | undefined;
  if (!accessToken) throw new Error('No access token returned by the provider.');

  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'FoxSchema' };
  const uiRes = await fetch(e.userinfo, { headers });
  if (!uiRes.ok) throw new Error(`Could not read profile (${uiRes.status})`);
  const ui = (await uiRes.json()) as JsonRecord;
  let email = (ui.email as string) || (ui.preferred_username as string) || '';

  // GitHub may not expose a public email — fetch the primary verified one.
  if (p.id === 'github' && !email) {
    const emRes = await fetch('https://api.github.com/user/emails', { headers });
    if (emRes.ok) {
      const emails = (await emRes.json()) as { email: string; primary: boolean; verified: boolean }[];
      const pick = emails.find((x) => x.primary && x.verified) || emails.find((x) => x.verified);
      email = pick?.email || '';
    }
  }

  if (!email || !email.includes('@')) throw new Error('The provider did not return a verified email.');
  return email.trim().toLowerCase();
}
