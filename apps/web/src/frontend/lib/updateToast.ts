import type { UpdateInfo } from '../api/updatesApi';
import { toast } from '../store/toastStore';

const DISMISSED_KEY = 'foxschema-update-toast-v';

function dismissedFor(latest: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === latest;
  } catch {
    return false;
  }
}

export function rememberUpdateToastDismissed(latest: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, latest);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Boot-time toast when a newer version is available.
 * Deduped per `latest` so refresh doesn't re-spam after dismiss / view.
 */
export function maybeToastUpdateAvailable(info: UpdateInfo | null, opts?: { force?: boolean }): void {
  if (!info?.updateAvailable || !info.latest) return;
  if (!opts?.force && dismissedFor(info.latest)) return;

  toast({
    tone: 'warning',
    title: `Update available · v${info.latest}`,
    body: `You're on v${info.current}. A newer Fox Schema release is ready.`,
    actionLabel: info.url ? 'View release' : undefined,
    actionHref: info.url,
    durationMs: 10_000,
  });
  rememberUpdateToastDismissed(info.latest);
}

/** Result toast after an explicit Settings → Check click. */
export function toastUpdateCheckResult(info: UpdateInfo | null): void {
  if (!info) {
    toast({
      tone: 'info',
      title: "Couldn't check for updates",
      body: 'The update feed is unreachable right now. Try again later.',
    });
    return;
  }
  if (info.updateAvailable) {
    maybeToastUpdateAvailable(info, { force: true });
    return;
  }
  toast({
    tone: 'success',
    title: 'You are up to date',
    body: info.configured
      ? `Fox Schema v${info.current} is the latest release.`
      : `Fox Schema v${info.current} (no update feed configured).`,
  });
}
