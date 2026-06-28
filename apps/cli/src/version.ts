import { createRequire } from 'node:module';

// Injected by esbuild `define` in the bundle/binary builds; falls back to
// reading package.json when running from source (tsx). The package.json read
// can't work inside a SEA binary, so the define path is used there.
declare const __CLI_VERSION__: string | undefined;

function resolveVersion(): string {
  if (typeof __CLI_VERSION__ === 'string') return __CLI_VERSION__;
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export const VERSION: string = resolveVersion();
