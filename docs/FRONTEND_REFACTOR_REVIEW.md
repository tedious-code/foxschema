# Frontend refactor plan — review, and the version adapted to this codebase

Review of `frontend-feature-domain-refactor-plan.md`, measured against the
actual frontend rather than against the plan's generic example.

**Verdict: the direction is right and the move is safe to make. Roughly a third
of the document describes an application this is not, and two of its rules would
do damage if followed literally.** What follows separates those.

---

## 1. What the frontend actually looks like

| | |
|---|---|
| Size | **226 files, 59,736 lines** (164 non-test) |
| Already feature-grouped | `components/{access, lokee-weave, object-detail, sql-editor, utilities}` — **74 files** |
| Not yet grouped | **36** loose components at the top of `components/` |
| Global folders | `lib` 41 · `api` 14 · `store` 9 · `utils` 7 |

The plan opens with a structure where every feature is scattered across
`components/`, `hooks/`, `services/`, `utils/`. **That is not this repo.** Two
thirds of the components are already grouped by domain, and there is no `hooks/`
or `services/` folder at all. The work is finishing a grouping that is well
under way, not starting one.

---

## 2. Sections that do not apply — nothing here to move

Each of these was checked, not assumed:

| Plan section | Reality |
|---|---|
| §3 `app/router/`, §25 Route Organization | **No router.** No `react-router` dependency, no `<Routes>`. One page, tab state. |
| §10.1 Server state via React Query | **Not installed.** No `@tanstack/*`, no `swr`. State is Zustand throughout. |
| §26 Layout responsibility, `pages/` per feature | **No `pages/`, no `layouts/`.** |
| §13 Forms and validation | **No form library.** No `react-hook-form`, `zod`, `formik`, `yup`. |

Adopting React Query would be a **state-management rewrite**, not a move — every
data-loading path in the app would change behaviour. It may be worth doing one
day; it is not part of relocating files, and bundling it here would mean no one
could tell a move regression from a state regression.

---

## 3. Two rules that would do damage as written

### §15 Component Size — do not split during the move

The largest files:

```
2,979  components/sql-editor/TableBlueprintModal.tsx
2,397  store/useSqlEditorStore.ts
1,941  components/sql-editor/tableBlueprintSql.ts
1,889  components/sql-editor/ResultsPanel.tsx
1,643  components/sql-editor/DataGrid.tsx
```

These genuinely are too big. Splitting them is also a **rewrite**, and the
frontend's automated coverage (86 jsdom tests) cannot tell a correct split from
a subtly broken one. A file move and a rewrite in the same commit produce a diff
nobody can review — which is the same reason `lokee-weave.service.ts` was moved
without being split during the backend work.

**Split them afterwards, one at a time, each with its own tests.**

### §6 `shared/` is a dumping ground — only half true here

Measured by import graph, of the 71 files in the global folders:

| | Files |
|---|---|
| Used by exactly **one** feature → genuinely misplaced, safe to move | **35** |
| Used by **two or more** features → genuinely shared, must stay | **31** |
| Dead | **0** |

So the plan's premise holds for about half the files and is wrong about the
other half. `useSyncStore` is imported by **7** areas; `provider-settings`,
`types`, `schemaApi`, `toastStore` by five each. Pushing those into a feature
would invert the dependency direction the plan itself insists on (§7).

**And a boundary the plan cannot know about:** `CLAUDE.md` records that files in
`frontend/lib/` are *thin re-export facades over `@foxschema/sql`, not copies*.
Scattering those into features risks someone reaching for `@foxschema/db`
instead — which fails the Vite build **on purpose**, because the frontend must
never pull in the driver runtime. Those facades stay where they are, as a
boundary.

---

## 4. What the plan is missing: the thing that makes it safe

The plan has no regression net. The backend restructure was safe because an
80-route contract suite pinned behaviour first.

**The frontend already has its equivalent**, and it is better than expected:

```
497  data-testid references in the e2e suite
  0  references to frontend file paths
```

The e2e suite drives the DOM by test id and never mentions a file location. So
**a pure file move cannot break it** — which makes e2e the contract, exactly as
the HTTP suite was for the backend. That property holds only while the move
stays a move: the moment a component is split, testids move with the split and
the net stops being free.

Per-phase gate: `tsc --noEmit` → `vitest run` → `vite build` → e2e smoke + one
dialect. The build matters — path aliases are resolved by the bundler, and
`tsc` alone will not catch a broken alias.

---

## 5. The adapted plan

Same spirit as the document, minus what does not exist, plus the net.

| Phase | Work | Risk |
|---|---|---|
| **0** | Inventory by import graph — done, see §1 and §3 above | none |
| **1** | Add the `@/` alias to `tsconfig.json` *and* `vite.config.ts` *and* the root `vitest.config.ts`. Create `features/` and `shared/` | low — three copies of resolution, all must agree |
| **2** | Move the **35 single-consumer files** into the feature that uses them | low — mechanical, verified by build + e2e |
| **3** | Promote the 5 existing component groups to `features/*`, add `index.ts` public APIs | low |
| **4** | Sort the 36 loose components: feature-owned vs app-shell | medium — needs judgement per file |
| **5** | `shared/` gets the 31 genuinely-shared files; keep the `@foxschema/sql` facades intact | low |
| **6** | Enforce boundaries with a lint rule / purity-style test, as `packages/shared` already does | low |
| **7** | *Separately*: split the oversized files, one PR each | **high — not part of the move** |

### Naming

The plan says `features/`. This repo's backend already calls the same concept
`modules/`. Either is fine, but they should match — a reader should not have to
learn two words for one idea. Recommend `features/` on the frontend only if the
backend is renamed too; otherwise use `modules/` on both.

---

## 6. Open question worth answering before phase 4

The 36 loose components split into two groups that are not obviously
distinguishable: things that belong to a feature, and things that are the app
shell (`TopToolbar`, `ProfileMenu`, `LoadingScreen`, `BackendOfflineBanner`,
`ActivityIndicator`). The plan has no home for an app shell — its `app/` folder
is router/providers/config.

Recommend `app/shell/` for those, so `features/` stays business-only.
