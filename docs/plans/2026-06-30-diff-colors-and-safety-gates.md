# Diff colors and migration safety gates — 2026-06-30

## Summary

Two related UI/UX changes to the compare-and-migrate flow, both dialect-agnostic
(driven by `TableDiff.status` and generated SQL content, not by `dialect`):

1. **DDL diff panel** (`ObjectDetailPanel.tsx` → `SqlDiffEditor`) now orients
   left = Source (original), right = Target (destination) — matching the
   Source/Target connection panel layout in the toolbar — and colors the diff
   by what the migration will *do* to the object, not by which side added or
   removed a line:
   - 🟢 green — brand-new object (`ADDED`)
   - 🟠 amber — existing object's definition changed (`MODIFIED`)
   - 🔴 red — object is being dropped (`REMOVED`)

2. **Execute button safety gating.** Previously Execute only disabled for
   lifecycle/selection reasons (no objects selected, compare/migration in
   flight). Four risk signals existed but only warned — never blocked:
   - Drop-dependency conflicts (dropped table/column still referenced by a
     view/function/procedure staying in target) — had a one-click
     "Deploy anyway" bypass.
   - Destructive drops (`DROP TABLE/COLUMN/INDEX`) with non-destructive mode
     off — no gate at all.
   - Target connection health — never checked.
   - MySQL/MariaDB routine/trigger + binlog privilege risk — static
     informational banner only.

   All four now actively disable Execute until resolved: dependency conflicts
   require inclusion or deselection (bypass removed), destructive drops and
   the MySQL binlog risk require an explicit checkbox acknowledgment (reset
   whenever the underlying plan changes), and an unhealthy target connection
   blocks outright with no bypass.

## Why

- User feedback: the diff view's left/right orientation didn't match the
  rest of the app (Source panel is on the left everywhere else), and a
  fixed "green=added/red=removed" scheme was confusing once left/right no
  longer mapped to a fixed direction — the color needed to signal migration
  intent (new/changed/dropped) instead.
- Follow-up ask: "buttons should disable when migration pipeline would be
  safer" — the Execute button was a pure lifecycle gate with no correctness
  signal; several real risk conditions already existed in the codebase but
  only produced a dismissible warning.

## Implementation

| File | Change |
|---|---|
| `apps/web/src/frontend/monaco-setup.ts` | Added three status-keyed Monaco diff themes (green/amber/red, dark + light) — `MONACO_DIFF_THEME` / `MONACO_DIFF_THEME_LIGHT` |
| `apps/web/src/frontend/components/SqlEditor.tsx` | `SqlDiffEditor` accepts a `status` prop (`ADDED`\|`MODIFIED`\|`REMOVED`, default `MODIFIED`) that picks the theme |
| `apps/web/src/frontend/components/ObjectDetailPanel.tsx` | Swapped `original`/`modified` props (source left, target right); status-aware legend; live `useMemo` for drop-dependency scan and destructive-drop detection; acknowledgment state keyed to `generatedSql` so any plan change invalidates a stale checkbox; new safety banner row visible on every tab; `executeBlockReason` single source of truth for the disabled state and tooltip |
| `apps/web/src/frontend/components/object-detail/DependencyWarningDialog.tsx` | Removed `onDeployAnyway` / "Deploy anyway" button entirely; non-deployable dependents now show a hint to deselect the drop instead |

## Verification

- `cd apps/web && npx tsc --noEmit` — clean
- `npx vitest run` — 92/92 passing
- Live browser verification (Playwright against seeded MySQL `demo_a`/`demo_b`):
  - `ADDED` object (`CATEGORIES`) → green diff, "new object" legend
  - `MODIFIED` object (`CUSTOMERS`) → amber diff, "modified" legend
  - `REMOVED` object (`LEGACY_AUDIT_LOG`) → red diff, "dropped" legend
  - Selecting all 12 objects (destructive drops + MySQL routine/trigger
    creation both present) → Execute disabled, both acknowledgment
    checkboxes shown; ticking both unlocks Execute
- Dependency-conflict and target-unhealthy gates verified by code review —
  same pre-existing `findDropDependencies` call (now memoized instead of
  computed on click) and the same `targetConnected` store field already
  used elsewhere in the app.

## Not done / follow-ups

- No live repro was captured for the drop-dependency conflict banner
  specifically (constructing a scenario with a *staying* dependent object
  referencing a dropped column takes more seed-data setup than was
  in scope here) — logic is unchanged from the prior working
  implementation, only its trigger timing (continuous vs. on-click) and the
  bypass removal.
- The MySQL/MariaDB binlog banner in the "Migration SQL" tab (detailed
  remediation instructions) was left in place alongside the new gated
  banner — the new banner is the actual gate; the tab banner is
  supplementary detail with the exact `SET GLOBAL` command.
