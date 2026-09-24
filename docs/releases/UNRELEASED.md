# Unreleased

Notes for the next release. At ship time, rename this file to that version's
`RELEASE_<version>.md` and use it as the GitHub Release body.

## Schema history (Lokee): definitions are compared the way Compare compares them

Compare and Lokee used to decide "is this view / routine / trigger the same?"
differently. Compare folded case and dropped schema qualifiers; Lokee only
collapsed whitespace. So an object Compare called **unchanged** could still get
a new Lokee version — for example after the engine re-cased a view on storage,
or when the same body was captured with and without its `schema.` prefix.

Both now use one rule (`normalizeDefinitionText` in `@foxschema/sql`):

- whitespace and a trailing `;` are formatting;
- keyword and identifier case is folded;
- the history's own schema qualifier is ignored (`app.orders` = `orders`);
- **the case inside string literals is kept**: `status = 'Active'` and
  `status = 'active'` select different rows. Compare used to fold these too and
  report a real change as unchanged; it now reports it as modified.

Lokee applies the rule only when computing an object's hash. The definition it
stores is still exactly as captured, because revert builds its DDL from it.

### What you will see once

Hashes of views, routines and triggers change under the new rule. The first
capture of each existing history after upgrading records **one new version**
listing those objects as modified, although their text has not changed. After
that capture, versions appear only for real changes.

Revert and force-migrate are not affected by the boundary: when two stored
versions' hashes differ, both sides are re-hashed with the current rule before
deciding whether an object changed.
