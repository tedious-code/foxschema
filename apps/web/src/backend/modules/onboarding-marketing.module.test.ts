import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.APP_DB_PATH = ':memory:';

import {
  forwardOnboardingSurvey,
  resolveOnboardingWebhookUrl,
} from './onboarding-marketing.module';
import { AuthModule } from './auth.module';
import { UserModule } from './user.module';

describe('onboarding marketing webhook', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ONBOARDING_WEBHOOK_URL;
    delete process.env.ONBOARDING_WEBHOOK_SECRET;
    delete process.env.SIGNUP_WEBHOOK_URL;
    delete process.env.SIGNUP_WEBHOOK_SECRET;
  });

  it('resolveOnboardingWebhookUrl prefers the dedicated URL', () => {
    process.env.SIGNUP_WEBHOOK_URL = 'https://example.com/signup';
    process.env.ONBOARDING_WEBHOOK_URL = 'https://example.com/onboarding';
    expect(resolveOnboardingWebhookUrl()).toBe('https://example.com/onboarding');
  });

  it('resolveOnboardingWebhookUrl falls back to the signup webhook', () => {
    process.env.SIGNUP_WEBHOOK_URL = 'https://example.com/signup';
    expect(resolveOnboardingWebhookUrl()).toBe('https://example.com/signup');
  });

  it('forwardOnboardingSurvey no-ops when no webhook is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(
      await forwardOnboardingSurvey({
        email: 'a@example.com',
        role: 'DBA',
        primaryDatabase: 'DB2',
        primaryGoal: 'COMPARE_SCHEMAS',
      })
    ).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwardOnboardingSurvey posts survey fields with event discriminator', async () => {
    process.env.ONBOARDING_WEBHOOK_URL = 'https://example.com/onboarding';
    process.env.ONBOARDING_WEBHOOK_SECRET = 's3cret';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    expect(
      await forwardOnboardingSurvey({
        email: '  Persona@Example.com ',
        role: 'Developer',
        primaryDatabase: 'PostgreSQL',
        primaryGoal: 'GENERATE_SQL',
        source: 'web',
      })
    ).toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/onboarding',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Foxschema-Signup-Secret': 's3cret' }),
        body: JSON.stringify({
          event: 'onboarding_survey',
          email: 'persona@example.com',
          role: 'Developer',
          primaryDatabase: 'PostgreSQL',
          primaryGoal: 'GENERATE_SQL',
          source: 'web',
        }),
      })
    );
  });

  it('forwardOnboardingSurvey returns false on webhook failure without throwing', async () => {
    process.env.ONBOARDING_WEBHOOK_URL = 'https://example.com/onboarding';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(
      forwardOnboardingSurvey({ email: 'a@example.com', role: 'DBA' })
    ).resolves.toBe(false);
  });

  it('UserModule forwards survey once when onboarding completes', async () => {
    process.env.ONBOARDING_WEBHOOK_URL = 'https://example.com/onboarding';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const auth = new AuthModule();
    const users = new UserModule();
    const { user } = await auth.register('mkt@example.com', 'password123');

    await users.updatePreferences(user.id, {
      role: 'Analyst',
      primaryDatabase: 'MySQL',
      primaryGoal: 'EXPLORE_DATABASE',
      onboardingCompleted: true,
    });

    // Allow the fire-and-forget forward to settle.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string) as {
      event: string;
      email: string;
      role: string;
      primaryDatabase: string;
      primaryGoal: string;
    };
    expect(body).toMatchObject({
      event: 'onboarding_survey',
      email: 'mkt@example.com',
      role: 'Analyst',
      primaryDatabase: 'MySQL',
      primaryGoal: 'EXPLORE_DATABASE',
    });

    // Theme-only update must not re-post.
    fetchSpy.mockClear();
    await users.updatePreferences(user.id, { theme: 'dark' });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
