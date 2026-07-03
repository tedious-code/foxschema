import { isTauri } from '../api/apiBase';

/**
 * Defense-in-depth against opening the WebView inspector in the packaged desktop app.
 *
 * The primary protection is the build itself: release builds are compiled WITHOUT the
 * Tauri `devtools` feature, so the inspector isn't present at all. This guard additionally
 * blocks the usual entry points (right-click "Inspect Element", F12, Ctrl/⌘+Shift+I/J/C,
 * ⌘+⌥+I/J/C, Ctrl+U) so a debug build or a curious user can't pop it open either.
 *
 * No-op in the browser web app and in dev — we only harden the packaged desktop shell in
 * production, and never interfere with normal web usage or local development.
 */
export function hardenAgainstInspect(): void {
  if (import.meta.env.DEV || !isTauri()) return;

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const key = e.key.toUpperCase();
    const mod = e.ctrlKey || e.metaKey;
    const isDevtoolsCombo =
      e.key === 'F12' ||
      (mod && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) ||
      // macOS ⌘⌥I/J/C only — NOT e.ctrlKey: on Windows/Linux, Ctrl+Alt+<letter> is how
      // AltGr is reported (standard browser behavior), and several European keyboard
      // layouts type accented characters via AltGr (e.g. Polish AltGr+C -> ć). Scoping
      // this to metaKey avoids swallowing normal text input on those layouts — there's
      // no legitimate Ctrl+Alt devtools shortcut on those platforms to block anyway
      // (they use Ctrl+Shift+I/J/C, already covered above).
      (e.metaKey && e.altKey && (key === 'I' || key === 'J' || key === 'C')) ||
      (mod && key === 'U'); // view-source
    if (isDevtoolsCombo) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}
