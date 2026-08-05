/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Forwards completed onboarding survey answers to foxschema.com for product
 * marketing / persona insights. Mirrors the signup webhook pattern: optional
 * URL, short timeout, never blocks completing the wizard when outbound fails.
 */

const WEBHOOK_TIMEOUT_MS = 5000;

export interface OnboardingSurveyPayload {
  email: string;
  role?: string;
  primaryDatabase?: string;
  primaryGoal?: string;
  source?: 'web' | 'cli';
}

/**
 * Resolve the marketing webhook URL. Prefer a dedicated onboarding endpoint;
 * fall back to the signup webhook so a single WordPress install can accept
 * both events when only SIGNUP_WEBHOOK_URL is configured.
 */
export function resolveOnboardingWebhookUrl(): string | undefined {
  const dedicated = (process.env.ONBOARDING_WEBHOOK_URL || '').trim();
  if (dedicated) return dedicated;
  const signup = (process.env.SIGNUP_WEBHOOK_URL || '').trim();
  return signup || undefined;
}

function webhookSecret(): string | undefined {
  const dedicated = (process.env.ONBOARDING_WEBHOOK_SECRET || '').trim();
  if (dedicated) return dedicated;
  const signup = (process.env.SIGNUP_WEBHOOK_SECRET || '').trim();
  return signup || undefined;
}

/**
 * Best-effort POST of survey answers. Swallows errors — local prefs already
 * saved; marketing sync must not fail the user's onboarding completion.
 */
export async function forwardOnboardingSurvey(payload: OnboardingSurveyPayload): Promise<boolean> {
  const url = resolveOnboardingWebhookUrl();
  if (!url) return false;

  const email = (payload.email || '').trim().toLowerCase();
  if (!email.includes('@')) return false;

  const secret = webhookSecret();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Foxschema-Signup-Secret': secret } : {}),
      },
      body: JSON.stringify({
        event: 'onboarding_survey',
        email,
        role: payload.role ?? null,
        primaryDatabase: payload.primaryDatabase ?? null,
        primaryGoal: payload.primaryGoal ?? null,
        source: payload.source ?? 'web',
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
