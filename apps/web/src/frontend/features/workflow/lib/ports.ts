/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (lib/ports.ts).
 */
/**
 * Friendlier labels for well-known port names, shared by the canvas node
 * handles and the inspector's port chips.
 *
 * Edge pills (`PipeEdge`) keep their own, narrower map on purpose: they relabel
 * only the branch ports and show any other port name as written.
 */
const PORT_LABEL: Record<string, string> = {
  true: 'Yes',
  false: 'No',
  rejects: 'Rejects',
  out: 'Out',
  in: 'In',
};

export function portLabel(name: string): string {
  return PORT_LABEL[name] ?? name;
}
