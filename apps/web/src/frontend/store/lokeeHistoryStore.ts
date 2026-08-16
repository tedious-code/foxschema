/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session state for History's Compare-style Original → Target pickers.
 * Not persisted — each visit defaults to previous version → current database.
 */
import { create } from 'zustand';
import type { LokeeDatabase } from '../api/lokeeApi';
import {
  swapHistoryCompare,
  type HistoryVersionOption,
} from '../lib/historyCompare';

interface LokeeHistoryState {
  databaseId: string | null;
  originalVersionId: string | null;
  targetVersionId: string | null;
  databases: LokeeDatabase[];
  versions: HistoryVersionOption[];
  setDatabaseId: (id: string | null) => void;
  setOriginalVersionId: (id: string | null) => void;
  setTargetVersionId: (id: string | null) => void;
  setDatabases: (rows: LokeeDatabase[]) => void;
  setVersions: (rows: HistoryVersionOption[]) => void;
  swapSides: () => void;
}

export const useLokeeHistoryStore = create<LokeeHistoryState>((set, get) => ({
  databaseId: null,
  originalVersionId: null,
  targetVersionId: null,
  databases: [],
  versions: [],
  setDatabaseId: (databaseId) => {
    if (get().databaseId === databaseId) return;
    set({ databaseId, originalVersionId: null, targetVersionId: null });
  },
  setOriginalVersionId: (originalVersionId) => set({ originalVersionId }),
  setTargetVersionId: (targetVersionId) => set({ targetVersionId }),
  setDatabases: (databases) => set({ databases }),
  setVersions: (versions) => set({ versions }),
  swapSides: () => {
    const next = swapHistoryCompare(get().versions, {
      originalVersionId: get().originalVersionId,
      targetVersionId: get().targetVersionId,
    });
    set({
      originalVersionId: next.originalVersionId,
      targetVersionId: next.targetVersionId,
    });
  },
}));
