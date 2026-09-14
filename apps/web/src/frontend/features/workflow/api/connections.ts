/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The caller's saved FoxSchema connections, and linking them to workflows.
 * FoxSchema's own API, not the engine's: the grant lives here.
 */
import type { WorkflowConnectionSummary } from '@foxschema/workflow-contract';
import { api as http } from '@/shared/api/client';

const path = (id: string) => `/workflow/connections/${encodeURIComponent(id)}/grant`;

export const workflowConnections = {
  list: async (): Promise<WorkflowConnectionSummary[]> =>
    (await http.get<{ connections: WorkflowConnectionSummary[] }>('/workflow/connections')).connections,
  /** Links the connection and resolves with the engine credential that points at it. */
  grant: (id: string): Promise<{ ok: true; credentialId: string }> => http.put(path(id)),
  revoke: (id: string): Promise<{ ok: true }> => http.delete(path(id)),
};
