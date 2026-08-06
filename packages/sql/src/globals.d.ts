/**
 * Build-time only. Not emitted, not shipped — tsc neither compiles nor copies
 * `.d.ts` inputs, so this never reaches a consumer and cannot clash with their
 * own lib settings.
 *
 * Why this exists instead of `"lib": ["es2022", "dom"]` in tsconfig.build.json:
 * adding `dom` would satisfy `URL`, but it would also make `document`, `window`,
 * `localStorage` and friends type-check cleanly inside this package. That is
 * exactly the mistake this package is built to prevent — it has to run in Node,
 * in a worker, and on an edge runtime, none of which have those. Declaring only
 * what is actually used keeps the build failing on anything else.
 *
 * `URL` is a WHATWG global, not a DOM API: Node ≥10, Deno, workers, and every
 * browser have it. `db2.connection.ts` uses it to parse `db2://` URLs.
 */
declare class URL {
  constructor(url: string, base?: string);
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
}
