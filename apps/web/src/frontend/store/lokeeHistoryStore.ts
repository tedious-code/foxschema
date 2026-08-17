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

  /**
   * Capture belongs to the same toolbar row as the pickers, but the fetching
   * and the graph live in LokeeWeaveView. Rather than passing callbacks
   * through the store, the bar bumps a counter and the view watches it — the
   * store stays plain data, which is what keeps it testable.
   */
  captureConnectionId: string;
  setCaptureConnectionId: (id: string) => void;
  capturing: boolean;
  setCapturing: (busy: boolean) => void;
  captureRequest: number;
  requestCapture: () => void;
  refreshRequest: number;
  requestRefresh: () => void;
  /** Bumped by the Target card's Compare button; the graph view opens the modal. */
  compareRequest: number;
  requestCompare: () => void;
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
  captureConnectionId: '',
  setCaptureConnectionId: (captureConnectionId) => set({ captureConnectionId }),
  capturing: false,
  setCapturing: (capturing) => set({ capturing }),
  captureRequest: 0,
  requestCapture: () => set({ captureRequest: get().captureRequest + 1 }),
  refreshRequest: 0,
  requestRefresh: () => set({ refreshRequest: get().refreshRequest + 1 }),
  compareRequest: 0,
  requestCompare: () => set({ compareRequest: get().compareRequest + 1 }),
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
