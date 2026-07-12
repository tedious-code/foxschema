import { AppSettingsStore } from './app-settings.module';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SHOWN_KEY = 'signup.wizard_shown';
// Cap on how long the outbound WordPress webhook call may block a request —
// without it a hung/slow endpoint ties up the Node request indefinitely.
const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * First-run "stay in the loop" wizard: captures an email, forwards it to the
 * WordPress signup webhook (foxschema.com owns storage/export/notification —
 * see docs/DEPLOYMENT.md), and remembers (via app_settings) that the wizard
 * has been resolved (submitted OR skipped) so it never shows again.
 */
export class SignupModule {
  constructor(private appSettings: AppSettingsStore) {}

  async getState(): Promise<{ shown: boolean }> {
    return { shown: (await this.appSettings.get(SHOWN_KEY)) === 'true' };
  }

  async skip(): Promise<void> {
    await this.appSettings.set(SHOWN_KEY, 'true');
  }

  /**
   * Forward `email` to the WordPress webhook. Only marks the wizard as shown
   * on a confirmed WordPress accept — a transient failure (webhook down,
   * misconfigured) leaves the wizard showing next launch instead of silently
   * dropping the signup, since capturing it is the entire point of this flow.
   */
  async submit(email: string, source: 'web' | 'desktop'): Promise<{ ok: boolean; error?: string }> {
    // The wizard is a one-time flow: once it's been resolved (submitted or
    // skipped) there's nothing more to forward. Short-circuiting here caps the
    // outbound side effects (WordPress post + notification email) to essentially
    // one per install, so a script hammering this endpoint after resolution
    // can't amplify into unbounded posts/emails.
    if ((await this.getState()).shown) return { ok: true };

    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) return { ok: false, error: 'Enter a valid email address.' };

    const url = process.env.SIGNUP_WEBHOOK_URL;
    if (!url) {
      // Not configured (e.g. local dev without the WordPress webhook set up) —
      // don't block the user on infra that isn't there; just resolve the wizard.
      await this.appSettings.set(SHOWN_KEY, 'true');
      return { ok: true };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SIGNUP_WEBHOOK_SECRET ? { 'X-Foxschema-Signup-Secret': process.env.SIGNUP_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify({ email: trimmed, source }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not reach the signup service';
      return { ok: false, error: `Couldn't save your email right now (${message}). Try again, or skip for now.` };
    }

    await this.appSettings.set(SHOWN_KEY, 'true');
    return { ok: true };
  }
}
