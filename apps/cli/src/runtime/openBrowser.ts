import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/** Open a URL in the system default browser (macOS / Windows / Linux). */
export async function openBrowser(url: string): Promise<void> {
  const p = platform();
  if (p === 'darwin') {
    await runDetached('open', [url]);
    return;
  }
  if (p === 'win32') {
    // `start` is a cmd builtin; empty title avoids swallowing the URL.
    await runDetached('cmd', ['/c', 'start', '', url]);
    return;
  }
  await runDetached('xdg-open', [url]);
}

function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: platform() === 'win32',
    });
    child.on('error', reject);
    child.unref();
    // Give the OS a moment to fail fast on missing binary; otherwise resolve.
    setTimeout(() => resolve(), 50);
  });
}
