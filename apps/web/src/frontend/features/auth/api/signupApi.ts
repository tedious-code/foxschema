import { getApiBase, parseJsonResponse } from '@/shared/api/apiBase';

/** Whether the first-run signup wizard has already been resolved (submitted or skipped). */
export async function getSignupState(): Promise<{ shown: boolean }> {
  const res = await fetch(`${getApiBase()}/signup/state`, { credentials: 'include' });
  return parseJsonResponse<{ shown: boolean }>(res);
}

export async function submitSignup(email: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${getApiBase()}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, source: 'web' }),
  });
  // Soft: UI shows error from body even when status is non-OK.
  try {
    return await parseJsonResponse<{ ok: boolean; error?: string }>(res);
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function skipSignup(): Promise<void> {
  await fetch(`${getApiBase()}/signup/skip`, { method: 'POST', credentials: 'include' });
}
