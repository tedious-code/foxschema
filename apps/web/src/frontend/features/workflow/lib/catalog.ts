/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (catalog.ts).
 */
import type { PipeMetadata, PipeProvider } from '../api/engineClient';

export type PipeRole = 'source' | 'transform' | 'sink';

export interface CatalogEntry {
  type: string;
  role: PipeRole;
  label: string;
  category: string;
  /** Second level of `Group/Subgroup`, when the pipe declares one. */
  subcategory?: string;
  version: string;
  configSchema: Record<string, unknown>;
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  simple?: boolean;
  /** `advanced` pipes are hidden until the palette toggle is on. */
  palette?: 'primary' | 'advanced';
  /** Capability pack from pipe metadata (auth, notify, …). */
  family?: string;
  tags?: string[];
  /** The hand-kept mirror of `@foxagent/common` lives on `PipeMetadata` — one copy. */
  triggerKind?: PipeMetadata['triggerKind'];
  provider?: PipeProvider;
}

/** Entries sharing a subgroup, rendered under their own heading. */
export interface CatalogSubgroup {
  id: string;
  label: string;
  entries: CatalogEntry[];
}

export interface CatalogCategory {
  id: string;
  label: string;
  /** Flattened entries, in the order the subgroups render. */
  entries: CatalogEntry[];
  /**
   * Present only when this category's pipes declare `Group/Subgroup`. A
   * category without subgroups stays a flat list, as before.
   */
  subgroups?: CatalogSubgroup[];
}

const CATEGORY_SEPARATOR = '/';
/** Bucket key for entries in a group that declare no subgroup. */
const NO_SUBGROUP = '';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function isThirdParty(provider: PipeProvider | undefined): boolean {
  return provider !== undefined && provider.origin !== 'builtin';
}

/** Split `Sources/Database` into its group and optional subgroup. */
export function splitCategory(category: string): {
  group: string;
  subgroup?: string;
} {
  const index = category.indexOf(CATEGORY_SEPARATOR);
  if (index === -1) return { group: category.trim() };
  const group = category.slice(0, index).trim();
  const subgroup = category.slice(index + 1).trim();
  return subgroup ? { group, subgroup } : { group };
}

function toEntry(meta: PipeMetadata): CatalogEntry {
  const { subgroup } = splitCategory(meta.category);
  return {
    type: meta.type,
    role: meta.role,
    label: meta.name,
    category: meta.category,
    ...(subgroup ? { subcategory: subgroup } : {}),
    version: meta.version,
    configSchema: meta.configSchema,
    inputs: meta.inputs,
    outputs: meta.outputs,
    simple: meta.simple,
    palette: meta.palette === 'advanced' ? 'advanced' : 'primary',
    ...(meta.family ? { family: meta.family } : {}),
    ...(meta.tags?.length ? { tags: meta.tags } : {}),
    triggerKind: meta.triggerKind,
    provider: meta.provider,
  };
}

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label);

/**
 * Build palette categories from registry metadata (no hardcoded pipe types).
 * `category` answers what a pipe does — optionally two levels as
 * `Group/Subgroup` — while `provider` answers whose it is: FoxAgent built-in
 * groups come first, then third-party namespaces get their own labelled groups.
 */
export function categoriesFromPipes(
  pipes: PipeMetadata[],
): CatalogCategory[] {
  const byGroup = new Map<string, Map<string, CatalogEntry[]>>();

  for (const meta of pipes) {
    const { group, subgroup } = splitCategory(meta.category);
    const label = isThirdParty(meta.provider)
      ? `${group} · ${meta.provider!.namespace}`
      : group;
    const subgroups = byGroup.get(label) ?? new Map<string, CatalogEntry[]>();
    const key = subgroup ?? NO_SUBGROUP;
    subgroups.set(key, [...(subgroups.get(key) ?? []), toEntry(meta)]);
    byGroup.set(label, subgroups);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      // Built-in groups (no namespace suffix) sort before third-party ones.
      const thirdA = a.includes(' · ') ? 1 : 0;
      const thirdB = b.includes(' · ') ? 1 : 0;
      return thirdA - thirdB || a.localeCompare(b);
    })
    .map(([label, subgroupMap]) => {
      const named = [...subgroupMap.entries()]
        .filter(([key]) => key !== NO_SUBGROUP)
        .map(([key, entries]) => ({
          id: `${slug(label)}-${slug(key)}`,
          label: key,
          entries: entries.sort(byLabel),
        }))
        .sort(byLabel);
      // Entries without a subgroup render above the named ones.
      const loose = (subgroupMap.get(NO_SUBGROUP) ?? []).sort(byLabel);

      return {
        id: slug(label),
        label,
        entries: [...loose, ...named.flatMap((sub) => sub.entries)],
        ...(named.length > 0
          ? {
              subgroups: [
                ...(loose.length > 0
                  ? [{ id: `${slug(label)}-other`, label: '', entries: loose }]
                  : []),
                ...named,
              ],
            }
          : {}),
      };
    });
}

export function catalogFromPipes(
  pipes: PipeMetadata[],
): CatalogEntry[] {
  return categoriesFromPipes(pipes).flatMap((c) => c.entries);
}
