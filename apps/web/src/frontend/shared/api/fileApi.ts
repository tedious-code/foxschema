/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browse directories on the machine running the backend, for picking a SQLite
 * or DuckDB file. Names only — this endpoint never returns file contents.
 */
import { getApiBase, parseJsonResponse } from './apiBase';

export interface FileBrowseEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size?: number;
  modifiedAt?: string;
}

export interface FileBrowseResult {
  path: string;
  parent: string | null;
  home: string;
  entries: FileBrowseEntry[];
  truncated: boolean;
}

export async function browseFiles(path?: string): Promise<FileBrowseResult> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`${getApiBase()}/files/browse${query}`, { credentials: 'include' });
  return parseJsonResponse<FileBrowseResult>(res);
}
