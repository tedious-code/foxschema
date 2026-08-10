# Component tests (`web-ui` project)

React components rendered in jsdom, via Testing Library.

```bash
npx vitest run --project web-ui        # just these
npx vitest run                         # everything (CI does this)
```

Files match `apps/web/src/**/*.test.tsx`. The `.tsx` extension is what selects
the project — a `.test.ts` file stays in the pure-node `unit` project and will
not have a DOM.

## Which tool for which job

| Question | Use |
|---|---|
| Does this function compute the right value? | `.test.ts` (unit) |
| Does this component render the right thing for these props? | `.test.tsx` (here) |
| Does the whole flow work against a real database? | `apps/e2e` |

Reach for the cheapest one that can actually fail. A rendering rule tested here
runs in milliseconds and fails deterministically; the same rule tested through
e2e needs a server, a browser, a seeded database, and careful timing.

`ResultsPanel.test.tsx` is the worked example. It pins the regression from
[#214](https://github.com/tedious-code/foxschema/pull/214), where a dispatched
query left the side-by-side results area blank. The e2e version of that check
needs a deliberately slow query and a `MutationObserver` to catch a window of
tens of milliseconds, and before it was rewritten it caught the bug roughly one
run in five. Here it is four plain assertions that fail in ~20ms.

## Setup

`setup.ts` runs before each file and provides what jsdom lacks —
`ResizeObserver`, `matchMedia`, `Element.scrollTo` — plus `cleanup()` between
tests. A leaked tree does not fail loudly; it makes the *next* test's queries
ambiguous, which is a miserable thing to debug.

Add to `setup.ts` only what jsdom genuinely does not implement. A stub that
papers over a real component bug is worse than a failing test.
