# Link Servers — cross-database data move via JS + SQL

## Goal

Evolve saved credentials into **Link Servers** so an editor script can move data
between databases using mixed JavaScript/TypeScript and SQL (`sql.on(alias)`),
with async / Promises. Clients choose source and target servers (and tables);
the editor runtime queries only through the server-side bridge (passwords never
reach the browser sandbox).

## Out of scope (v1)

- Billing, entitlements, edition gates, or “commercial” product wording anywhere
  in code, UI copy, or docs for this feature
- Background job service (progress UI beyond the editor run is later)
- Distributed transactions across servers

## Locked decisions

| Rule | Value |
|------|--------|
| Link servers selectable per editor Execute | **up to 2** (source + target) |
| `sql.on()` calls per editor Execute | **up to 10** |
| Async / Promises in Node cells | **required** (already supported by code-cell runtime) |
| Password / decrypt | Server-only via existing `resolveRef` / connection store |

## Concepts

- **Link Server** — a saved connection used with an **alias** in editor scripts
  (same encrypted store as today’s credentials; metadata adds alias + role for
  the run: source | target).
- **`sql.on(alias)`** — Node/`@nodets` cell bridge that runs SQL on the link
  bound to `alias` for this Execute (same trust model as today’s single-ref
  `sql\`...\``: worker posts query to parent; parent applies Safe mode + RBAC).
- **Editor Execute** — one Run from the SQL Editor (may include multiple
  statements / one code cell). Caps above apply per Execute.

## Editor contract (sketch)

```js
-- @node
const rows = await sql.on('oltp').`
  SELECT id, amount FROM orders WHERE id > ${cursor} LIMIT 500
`;
await sql.on('warehouse').`
  INSERT INTO orders_copy (id, amount) ${sql.values(rows)}
`;
return rows;
-- @end
```

- Aliases must map 1:1 to the at most **2** Link Servers chosen for the run.
- A third distinct alias / server → hard error.
- An 11th `sql.on()` in the same Execute → hard error.
- Browser-only `@js` / `@ts` cells do **not** get `sql.on` (no DB bridge).

## Backend sketch

1. Extend run payload for Node cells: `{ links: [{ alias, connectionId }], … }`
   (still one worker; parent `makeCellQueryRunner` resolves alias → `ConnectionRef`).
2. Count `sql.on` invocations in the parent bridge; reject over 10.
3. Reject if resolved distinct `connectionId`s > 2.
4. Keep existing row caps / write permission checks per statement.

## UI sketch

- Credentials manager gains Link Server framing (alias optional; default = name).
- SQL Editor run bar: pick **source** + **target** (max 2), not an unbounded
  Destinations fan-out for this mode.
- Samples: “copy rows oltp → warehouse” using `sql.on`.

## Phases

1. **Bridge** — multi-link `sql.on(alias)` + Enforce 2 servers / 10 calls.
2. **UI** — source/target picker + alias binding + sample script.
3. **Hardening** — chunk helpers, clearer errors, tests for caps and RBAC.

## Non-goals for naming in repo

Do not introduce strings or flags such as `commercial`, `enterprise`,
`entitlement`, `tokenQuota`, or paid-tier checks for Link Servers in this work.
Safety caps (2 servers / 10 `sql.on`) are product limits only.
