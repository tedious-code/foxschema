/**
 * Deliberately isolated from index.ts's top-level imports, and itself only
 * dynamic-imports ink/react below. Two reasons: (1) `fox <any other command>`
 * never pays React/Ink's load cost, and (2) on the compiled Node-SEA binary
 * (a CJS bundle), Ink's `yoga-layout` dependency has a top-level `await` in
 * its ESM entry, which fails through a synchronous `require()` — Node's async
 * `import()` loader handles it fine. Keeping the dynamic import here, one
 * level below the command dispatch in index.ts, is what makes that work.
 */
export async function runTui(): Promise<void> {
  const { render } = await import('ink');
  const React = (await import('react')).default;
  const { default: App } = await import('./App.js');
  const { waitUntilExit } = render(React.createElement(App));
  await waitUntilExit();
}
