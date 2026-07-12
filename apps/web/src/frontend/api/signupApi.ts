import { isTauri, getApiBase } from './apiBase';

/** Whether the first-run signup wizard has already been resolved (submitted or skipped). */
export async function getSignupState(): Promise<{ shown: boolean }> {
  const res = await fetch(`${getApiBase()}/signup/state`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load signup state');
  return res.json();
}

export async function submitSignup(email: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${getApiBase()}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, source: isTauri() ? 'desktop' : 'web' }),
  });
  return res.json();
}

export async function skipSignup(): Promise<void> {
  await fetch(`${getApiBase()}/signup/skip`, { method: 'POST', credentials: 'include' });
}
