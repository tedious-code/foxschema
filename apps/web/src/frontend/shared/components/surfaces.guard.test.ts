/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keeps the shared surfaces shared.
 *
 * `surfaces.tsx` was extracted because the same uppercase micro-label had been
 * written eight different ways across the frontend. An extraction alone does
 * not fix that — the next person writes the ninth spelling, and the module
 * becomes one more variant rather than the one definition. This fails the
 * build instead, the way naming.test.ts already guards file naming here.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sectionLabelCls } from './surfaces';

const FRONTEND = path.resolve(__dirname, '..', '..');
const OWN_FILE = 'surfaces.tsx';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith('.tsx') && !entry.includes('.test.') ? [full] : [];
  });
}

describe('shared surfaces stay shared', () => {
  it('nobody re-spells the section label as a literal', () => {
    // The exact string, as a bare className. Anything importing sectionLabelCls
    // is fine; this only catches a fresh copy of the literal.
    const literal = `className="${sectionLabelCls}"`;
    const offenders = tsxFiles(FRONTEND)
      .filter((f) => path.basename(f) !== OWN_FILE)
      .filter((f) => readFileSync(f, 'utf8').includes(literal))
      .map((f) => path.relative(FRONTEND, f));
    expect(offenders, 'use sectionLabelCls or <SectionLabel> from @/shared/components/surfaces').toEqual([]);
  });

  it('is worth guarding — the label is used widely enough to drift', () => {
    // If this ever drops to a handful, the guard above is protecting nothing
    // and the extraction should be reconsidered rather than defended.
    const users = tsxFiles(FRONTEND).filter((f) =>
      /sectionLabelCls|<SectionLabel/.test(readFileSync(f, 'utf8'))
    );
    expect(users.length).toBeGreaterThan(8);
  });
});
