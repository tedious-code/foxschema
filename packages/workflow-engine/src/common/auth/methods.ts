/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/auth/methods.ts).
 */
import {
  AUTH_METHODS,
  PROMPT_CHANNELS,
  authMethodSchema,
  promptChannelSchema,
  type AuthMethod,
  type PromptChannel,
} from '../pipes/families.js';

export {
  AUTH_METHODS,
  PROMPT_CHANNELS,
  authMethodSchema,
  promptChannelSchema,
  type AuthMethod,
  type PromptChannel,
};

/** Credential field sets designers and setup pages should offer per method. */
export const AUTH_METHOD_FIELDS: Record<
  AuthMethod,
  Array<{ key: string; label: string; secret?: boolean; optional?: boolean }>
> = {
  password: [
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  basic: [
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  bearer: [{ key: 'bearerToken', label: 'Bearer token', secret: true }],
  apiKey: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'headerName', label: 'Header name', optional: true },
  ],
  oauth: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
    { key: 'accessToken', label: 'Access token', secret: true, optional: true },
  ],
  openid: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
    { key: 'idToken', label: 'ID token', secret: true, optional: true },
  ],
  sso: [
    { key: 'username', label: 'Username', optional: true },
    { key: 'password', label: 'Password', secret: true, optional: true },
  ],
  otp: [{ key: 'otp', label: 'One-time code', secret: true, optional: true }],
  session: [{ key: 'cookies', label: 'Session cookies', secret: true }],
};

/**
 * Preferred FoxAgent shape for each auth method.
 * Login stays a callable workflow; HTTP auth stays on the shared httpAuthSchema.
 */
export const AUTH_METHOD_SHAPE: Record<
  AuthMethod,
  {
    /** Prefer these credential kinds (first is the designer default). */
    credentialKinds: Array<'http' | 'oauth' | 'webhook' | 'database' | 'llm'>;
    /** HTTP auth.type when applicable. */
    httpAuth?: 'none' | 'bearer' | 'basic' | 'apiKey' | 'credential';
    /** Human prompt when the secret is missing / OTP required. */
    promptWhenMissing?: PromptChannel[];
    note: string;
  }
> = {
  password: {
    credentialKinds: ['http'],
    httpAuth: 'basic',
    promptWhenMissing: ['webpage', 'pause'],
    note: 'Browser login workflows fill username/password from credential http.',
  },
  basic: {
    credentialKinds: ['http'],
    httpAuth: 'basic',
    promptWhenMissing: ['webpage'],
    note: 'HTTP Basic via auth.type=basic or credential secret fields.',
  },
  bearer: {
    credentialKinds: ['http', 'oauth'],
    httpAuth: 'bearer',
    promptWhenMissing: ['webpage'],
    note: 'Static or templated Bearer token; OAuth accessToken also maps here.',
  },
  apiKey: {
    credentialKinds: ['http'],
    httpAuth: 'apiKey',
    promptWhenMissing: ['webpage'],
    note: 'Header or query API key.',
  },
  oauth: {
    credentialKinds: ['oauth', 'http'],
    httpAuth: 'bearer',
    promptWhenMissing: ['webpage', 'notification'],
    note: 'tokenRefresh on HTTP pipes persists accessToken; Google/Meta packs use this.',
  },
  openid: {
    credentialKinds: ['oauth'],
    httpAuth: 'bearer',
    promptWhenMissing: ['webpage'],
    note: 'OIDC builds on OAuth; id_token validation is future work.',
  },
  sso: {
    credentialKinds: ['http'],
    promptWhenMissing: ['webpage', 'pause'],
    note: 'Enterprise SSO via browser.flow / headed login — not a single pipe.',
  },
  otp: {
    credentialKinds: ['http'],
    promptWhenMissing: ['sms', 'email', 'webpage', 'pause'],
    note: 'Future awaitHuman: pause run, notify channel, resume with otp field.',
  },
  session: {
    credentialKinds: ['http'],
    promptWhenMissing: ['webpage'],
    note: 'browser.cookies.save / HTTP session.persistToCredential.',
  },
};
