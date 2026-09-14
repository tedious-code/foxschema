/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/pipes/families.ts).
 */
import { z } from 'zod';

/**
 * Functional families concentrate similar pipes so the palette and agents
 * reason about *capability packs* instead of a flat type list.
 *
 * Families are orthogonal to `category` (`Source/API`, `Browser`, …):
 * category answers where a pipe sits in the graph; family answers which
 * product concern it serves (auth, notify, google, …).
 *
 * See docs/pipe-families.md.
 */
export const PIPE_FAMILIES = [
  'http',
  'database',
  'browser',
  'auth',
  'notify',
  'ai',
  'compose',
  'file',
  'trigger',
  'logic',
  /** Steps that stop and wait for a person: OTP, CAPTCHA, approval. */
  'human',
  /** Integration packs — prefer callable workflows over mega-pipes. */
  'integration.google',
  'integration.meta',
  'integration.wordpress',
  'integration.sales',
] as const;

export const pipeFamilySchema = z.enum(PIPE_FAMILIES);
export type PipeFamily = z.infer<typeof pipeFamilySchema>;

export const PIPE_FAMILY_LABELS: Record<PipeFamily, string> = {
  http: 'HTTP / APIs',
  database: 'Databases',
  browser: 'Browser',
  auth: 'Authentication',
  notify: 'Notifications',
  ai: 'AI',
  compose: 'Composition',
  file: 'Files',
  trigger: 'Triggers',
  human: 'Human in the loop',
  logic: 'Logic',
  'integration.google': 'Google',
  'integration.meta': 'Meta / Facebook',
  'integration.wordpress': 'WordPress',
  'integration.sales': 'Sales desk',
};

/**
 * How a run proves identity. Maps to HTTP `auth.type`, credential fields,
 * browser login workflows, and (future) human prompt channels — not to a
 * single mega “Login” pipe.
 */
export const AUTH_METHODS = [
  'password', // form / basic username+password
  'basic', // HTTP Basic
  'bearer', // opaque access token
  'apiKey', // header or query key
  'oauth', // OAuth2 / OIDC refresh+access (Google, Meta, …)
  'openid', // OpenID Connect id_token (+ oauth)
  'sso', // SAML / enterprise SSO via browser or IdP redirect
  'otp', // one-time code (email/SMS/app) — usually needs awaitHuman
  'session', // cookie jar / saved browser session
] as const;

export const authMethodSchema = z.enum(AUTH_METHODS);
export type AuthMethod = z.infer<typeof authMethodSchema>;

/**
 * When a secret is missing or OTP is required, how FoxAgent asks a human.
 * Today only `webpage` is prototyped (`GET /setup/credentials`).
 */
export const PROMPT_CHANNELS = [
  'webpage',
  'notification',
  'email',
  'sms',
  'pause', // run status paused until operator resumes
] as const;

export const promptChannelSchema = z.enum(PROMPT_CHANNELS);
export type PromptChannel = z.infer<typeof promptChannelSchema>;
