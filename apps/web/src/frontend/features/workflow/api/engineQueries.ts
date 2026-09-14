/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Engine reads shared across the Workflow screens: one cached request per key,
 * refreshed on demand or on an interval.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api, type CredentialMeta, type EnvironmentMeta, type MiddlewareMeta, type PipeMetadata, type RunRecord, type VariableMeta, type WorkflowSummary } from './engineClient';
import { catalogFromPipes, categoriesFromPipes, type CatalogCategory, type CatalogEntry } from '../lib/catalog';

interface CacheEntry {
  data?: unknown;
  /** 0 when the entry must be fetched again. */
  fetchedAt: number;
  inFlight?: Promise<void>;
}

const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function update(hash: string, entry: CacheEntry): void {
  cache.set(hash, entry);
  for (const listener of listeners) listener();
}

function load(hash: string, fetcher: () => Promise<unknown>): Promise<void> {
  const current = cache.get(hash) ?? { fetchedAt: 0 };
  if (current.inFlight) return current.inFlight;
  const inFlight = fetcher()
    .then(
      (data) => update(hash, { data, fetchedAt: Date.now() }),
      // Keep what was shown; a failed refresh is retried on the next trigger.
      () => update(hash, { data: current.data, fetchedAt: Date.now() }),
    );
  update(hash, { ...current, inFlight });
  return inFlight;
}

/** Mark every cached read whose key starts with `root` as stale; mounted readers refetch. */
export function invalidateEngineQueries(...roots: string[]): void {
  for (const [hash, entry] of cache) {
    if (roots.includes(JSON.parse(hash)[0])) update(hash, { ...entry, fetchedAt: 0 });
  }
}

function useEngineQuery<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  { enabled = true, staleMs = 0, intervalMs }: { enabled?: boolean; staleMs?: number; intervalMs?: number } = {},
): { data: T | undefined; loading: boolean } {
  const hash = JSON.stringify(key);
  const entry = useSyncExternalStore(subscribe, () => cache.get(hash));
  const fetchedAt = entry?.fetchedAt ?? 0;
  const inFlight = Boolean(entry?.inFlight);

  // On mount or a new key: fetch unless a fresh-enough copy is cached. This must
  // not re-run when a fetch completes — with `staleMs` 0 every completion would
  // look stale and start the next request, forever.
  useEffect(() => {
    if (!enabled) return;
    const current = cache.get(hash);
    if (!current || current.fetchedAt === 0 || Date.now() - current.fetchedAt > staleMs) {
      void load(hash, fetcher);
    }
    // `fetcher` is rebuilt every render; the key is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, enabled]);

  // Invalidated while mounted: fetch again.
  useEffect(() => {
    if (enabled && entry && fetchedAt === 0 && !inFlight) void load(hash, fetcher);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, enabled, fetchedAt, inFlight]);

  useEffect(() => {
    if (!enabled || !intervalMs) return;
    const timer = setInterval(() => void load(hash, fetcher), intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, enabled, intervalMs]);

  return { data: entry?.data as T | undefined, loading: enabled && entry?.data === undefined };
}

const EMPTY: never[] = [];

export function useCatalog(): { categories: CatalogCategory[]; catalog: CatalogEntry[] } {
  const { data } = useEngineQuery(['pipes'], () => api.listPipes(), { staleMs: 5 * 60_000 });
  const pipes: PipeMetadata[] = data?.pipes ?? EMPTY;
  return useMemo(
    () => ({ categories: categoriesFromPipes(pipes), catalog: catalogFromPipes(pipes) }),
    [pipes],
  );
}

export function useWorkflowList(enabled = true): WorkflowSummary[] {
  return useEngineQuery(['workflows'], () => api.listWorkflows(), { enabled, staleMs: 30_000 }).data ?? EMPTY;
}

/** Workflow list plus a refresh hook, for the management panel. */
export function useWorkflows(enabled = true) {
  const { data, loading } = useEngineQuery(['workflows'], () => api.listWorkflows(), { enabled });
  return { workflows: data ?? (EMPTY as WorkflowSummary[]), loading, refresh: () => invalidateEngineQueries('workflows') };
}

export function useMiddlewareCatalog(): MiddlewareMeta[] {
  return useEngineQuery(['middleware'], () => api.listMiddleware(), { staleMs: 5 * 60_000 }).data?.middleware ?? EMPTY;
}

export function useEnvironments() {
  const { data } = useEngineQuery(['environments'], () => api.listEnvironments());
  return {
    environments: data?.environments ?? (EMPTY as EnvironmentMeta[]),
    refresh: () => invalidateEngineQueries('environments', 'variables'),
  };
}

/** Variables for one environment, optionally narrowed to a workflow scope. */
export function useVariables(
  environmentId: string | undefined,
  query?: { scope?: 'global' | 'workflow'; workflowId?: string },
) {
  const { data } = useEngineQuery(
    ['variables', environmentId, query?.scope, query?.workflowId],
    () => api.listVariables(environmentId!, query),
    { enabled: Boolean(environmentId) },
  );
  return {
    variables: data?.variables ?? (EMPTY as VariableMeta[]),
    refresh: () => invalidateEngineQueries('variables'),
  };
}

export function useCredentials() {
  const { data } = useEngineQuery(['credentials'], () => api.listCredentials());
  return {
    credentials: data ?? (EMPTY as CredentialMeta[]),
    refresh: () => invalidateEngineQueries('credentials'),
  };
}

export function useRuns(enabled: boolean) {
  const { data } = useEngineQuery(['runs'], () => api.listRuns(), { enabled, intervalMs: 5_000 });
  return { runs: data ?? (EMPTY as RunRecord[]), refresh: () => invalidateEngineQueries('runs') };
}
