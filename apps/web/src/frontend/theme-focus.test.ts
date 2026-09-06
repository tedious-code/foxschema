/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Focus states follow the user's accent.
 *
 * `style.css` states the rule it exists to enforce: the accent is tunable in
 * Appearance settings "so the chosen color flows through key surfaces without
 * hardcoding a palette in every component". Focus was the largest surface still
 * ignoring it — 62 call sites across 28 files spelling one idea eleven ways
 * (cyan-300/400/500/600, cyan-600/50, sky-500/600, amber-400, amber-400/60,
 * amber-500, purple-500). Picking a non-cyan accent left every one of them cyan.
 *
 * They now use `.accent-focus`. This test exists because that is the kind of
 * thing one hurried `focus:border-cyan-500` puts straight back.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Focus colours that mean something, and so are not the accent's to take.
 *
 * Each is either a state (rose = this field is invalid) or a control whose
 * resting border already carries the same hue, where the focus colour is the
 * component's identity rather than a generic "has focus".
 */
const SEMANTIC: ReadonlyArray<readonly [string, string]> = [
  ['features/sql-editor/components/PeekRowEditor.tsx', 'focus:border-rose-400'],
  ['features/sql-editor/components/TableBlueprintModal.tsx', 'focus:border-violet-400'],
  ['features/sql-editor/components/TableBlueprintModal.tsx', 'focus:border-emerald-400'],
  ['features/lokee-weave/components/HistoryCompareBar.tsx', 'focus:border-purple-500'],
  ['shared/components/Autocomplete.tsx', 'focus:border-violet-400'],
];

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Every `focus:border-*` still written by hand, as [relative path, class]. */
function hardcodedFocusBorders(): Array<[string, string]> {
  return tsxFiles(FE).flatMap((file) => {
    const rel = path.relative(FE, file).split(path.sep).join('/');
    // Split into class-name tokens and filter, rather than matching a pattern.
    // The obvious `focus:border-[a-z]+-\d+(?:\/\d+)?` is a lint *error* here:
    // the trailing `?` wraps `\d{1,3}`, which is a quantifier inside a
    // quantifier, and `security/detect-unsafe-regex` rejects that star height
    // however tightly the pieces are bounded. Bounding them does not help.
    // Splitting has one quantifier and no ambiguity, and says what it means.
    const found = fs
      .readFileSync(file, 'utf8')
      .split(/[^A-Za-z0-9:/_-]+/)
      .filter((token) => token.startsWith('focus:border-'));
    return found.map((cls): [string, string] => [rel, cls]);
  });
}

describe('focus states follow the accent', () => {
  it('scans the frontend at all', () => {
    // A walker that matched nothing would make every assertion here vacuous.
    // .tsx only (101 today) — architecture.test.ts's >150 counts .ts as well.
    expect(tsxFiles(FE).length).toBeGreaterThan(90);
  });

  it('leaves no generic focus colour hardcoded', () => {
    const allowed = new Set(SEMANTIC.map(([f, c]) => `${f} ${c}`));
    const offenders = hardcodedFocusBorders()
      .map(([file, cls]) => `${file} ${cls}`)
      .filter((entry) => !allowed.has(entry))
      .sort();
    expect(offenders, 'use accent-focus, or add to SEMANTIC with the reason').toEqual([]);
  });

  it('keeps the exemptions honest — each one still exists', () => {
    // An exemption for a call site that has since been deleted or recoloured
    // quietly widens the allowlist for whatever lands there next.
    const present = new Set(hardcodedFocusBorders().map(([f, c]) => `${f} ${c}`));
    const stale = SEMANTIC.map(([f, c]) => `${f} ${c}`).filter((e) => !present.has(e));
    expect(stale, 'exemption no longer matches any call site — remove it').toEqual([]);
  });

  it('defines the utility the call sites now use', () => {
    const css = fs.readFileSync(path.join(FE, '..', 'style.css'), 'utf8');
    expect(css).toMatch(/\.accent-focus:focus\s*\{[^}]*var\(--accent\)/);
  });
});
