/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (catalog.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeMetadata } from '../api/engineClient';
import {
  categoriesFromPipes,
  splitCategory,
} from './catalog';

function pipe(
  type: string,
  category: string,
  extras: Partial<PipeMetadata> = {},
): PipeMetadata {
  return {
    type,
    name: extras.name ?? type,
    category,
    version: '0.1.0',
    role: 'source',
    inputs: [],
    outputs: [{ name: 'out', type: 'records' }],
    configSchema: { type: 'object' },
    ...extras,
  };
}

describe('splitCategory', () => {
  it('splits Group/Subgroup and leaves flat categories alone', () => {
    expect(splitCategory('Sources/Database')).toEqual({
      group: 'Sources',
      subgroup: 'Database',
    });
    expect(splitCategory('Triggers')).toEqual({ group: 'Triggers' });
    // A dangling separator is a flat group, not an empty subgroup.
    expect(splitCategory('Sources/')).toEqual({ group: 'Sources' });
  });
});

describe('categoriesFromPipes', () => {
  it('groups two-level categories into sorted subgroups', () => {
    const categories = categoriesFromPipes([
      pipe('source.file.csv', 'Sources/File', { name: 'CSV file' }),
      pipe('source.api.http', 'Sources/API', { name: 'HTTP API' }),
      pipe('source.db.postgres', 'Sources/Database', { name: 'PostgreSQL' }),
    ]);

    expect(categories).toHaveLength(1);
    const sources = categories[0]!;
    expect(sources.label).toBe('Sources');
    expect(sources.subgroups?.map((s) => s.label)).toEqual([
      'API',
      'Database',
      'File',
    ]);
    // Flattened entries follow the same order the subgroups render in.
    expect(sources.entries.map((e) => e.type)).toEqual([
      'source.api.http',
      'source.db.postgres',
      'source.file.csv',
    ]);
    expect(sources.entries[0]!.subcategory).toBe('API');
  });

  it('leaves single-level categories as flat lists with no subgroups', () => {
    const categories = categoriesFromPipes([
      pipe('source.trigger.manual', 'Triggers', { name: 'Manual Trigger' }),
      pipe('source.trigger.cron', 'Triggers', { name: 'Schedule Trigger' }),
    ]);

    expect(categories[0]!.subgroups).toBeUndefined();
    expect(categories[0]!.entries.map((e) => e.label)).toEqual([
      'Manual Trigger',
      'Schedule Trigger',
    ]);
    expect(categories[0]!.entries[0]!.subcategory).toBeUndefined();
  });

  it('renders ungrouped entries above named subgroups in a mixed group', () => {
    const categories = categoriesFromPipes([
      pipe('source.db.postgres', 'Sources/Database', { name: 'PostgreSQL' }),
      pipe('source.legacy', 'Sources', { name: 'Legacy source' }),
    ]);

    const sources = categories[0]!;
    expect(sources.subgroups?.map((s) => s.label)).toEqual(['', 'Database']);
    expect(sources.entries.map((e) => e.type)).toEqual([
      'source.legacy',
      'source.db.postgres',
    ]);
  });

  it('keeps third-party namespaces in their own group, subgroups intact', () => {
    const categories = categoriesFromPipes([
      pipe('source.file.csv', 'Sources/File', { name: 'CSV file' }),
      pipe('acme/source.file.parquet', 'Sources/File', {
        name: 'Parquet',
        provider: { namespace: 'acme', origin: 'plugin', package: '@acme/pipes' },
      }),
    ]);

    // Built-in group sorts first; the plugin gets its own labelled group.
    expect(categories.map((c) => c.label)).toEqual(['Sources', 'Sources · acme']);
    expect(categories[1]!.subgroups?.map((s) => s.label)).toEqual(['File']);
    expect(categories[1]!.entries.map((e) => e.type)).toEqual([
      'acme/source.file.parquet',
    ]);
  });
});
