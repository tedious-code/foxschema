# TUI tests (`fox tui`)

Tests for `apps/cli/src/tui/`, the Ink-based interactive UI. Two kinds:

- **State logic** (`state/__tests__/appReducer.test.ts`) — the screen-stack reducer is a
  plain `(state, action) -> state` function with no Ink/React involved; tested directly
  with Vitest.
- **Screen rendering + interaction** (`__tests__/*.test.tsx`) — via `ink-testing-library`'s
  `render()`, which returns `{ lastFrame, stdin }`. Data-fetching screens mock the same
  seams the line-command tests do (`vi.spyOn(store, 'getContext')` etc. — see
  `apps/cli/src/commands/__tests__/README.md`).

## No real TTY, ever

There is no interactive terminal available to drive `useInput`/`SelectInput`/`TextInput`
components manually — piping `tsx src/index.ts tui` through a non-TTY shell fails with
"Raw mode is not supported on the current process.stdin" the moment a component calls
`useInput`. `ink-testing-library`'s `render()` provides a fake stdin/stdout pair that
sidesteps this, and is the only way interactive screens get verified in this repo.

## The timing gotcha that will bite you

`ink-text-input` (and `ink-select-input`) need a render tick to commit each keystroke
before the *next* one is processed. Two failure modes, both confirmed by tracing the
actual `value` argument `onSubmit` receives:

1. **Typed text + Enter in the same tick.** `stdin.write('a@b.com\r')` — or two
   `stdin.write()` calls with no `await` between them — delivers an empty string to
   `onSubmit`, as if nothing was typed.
2. **No tick between `render()`/a data load finishing and the first `stdin.write()`.**
   Ink needs a tick to attach its input listener after a component mounts — including a
   `SelectInput` that only mounts once async data resolves (e.g. `CompareScreen` waiting
   on `useCompare`). The very first keystroke can be lost the same way as (1).

**Use `vi.waitFor()`, not a fixed-count `setTimeout(0)` flush, for anything with a
checkable outcome** (rendered text, a mock having been called). A `flush = () =>
setTimeout(r, 0)` used to be this file's answer, but it's flaky under full-suite parallel
load: this exact pattern caused a suite-wide ~1-in-4 failure rate the CLI test files
would occasionally reproduce individually but not in isolation — confirmed by hammering
`vitest run` head-to-head with a fixed count of `setTimeout(0)`s vs. `vi.waitFor`, only
the latter survived 27 consecutive full-suite runs. Prefer:
```ts
stdin.write('a@b.com');
await vi.waitFor(() => expect(onSomething).toHaveBeenCalled()); // or expect(lastFrame())...
```
The **one** exception is the "input listener needs a tick to attach" case, which has no
observable content change to poll for (the text was already rendered before the listener
attaches) — for that specific gap only, use a real millisecond-scale delay, not
`setTimeout(0)`:
```ts
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
...
await vi.waitFor(() => expect(lastFrame()).toContain('some rendered text'));
await wait(); // now safe to send a keypress — the listener has had time to attach
stdin.write('\r');
await vi.waitFor(() => expect(onSelect).toHaveBeenCalled());
```
The same two rules apply to `ink-select-input`'s arrow-key navigation
(`stdin.write('\x1b[B')` for down).

## `ink-select-input` items need an explicit string `key`

If an item's `value` is an object (not a primitive), every row's key stringifies to the
same `"[object Object]"` — React logs a duplicate-key warning and, more importantly,
your `onSelect` handler can end up wired to the wrong row. Always pass an explicit
`key: string` per item when `value` isn't already a primitive.

## Console output from passing tests

Vitest hides `console.log`/`console.error` output for tests that pass. If a render isn't
doing what you expect, either force a failing assertion temporarily or run with
`--reporter=verbose`, which prints captured stdout regardless of outcome — this is how
the two timing bugs above were actually diagnosed (a plain "it doesn't work" guess would
have wasted time on the wrong fix).
