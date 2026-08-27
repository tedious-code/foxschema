/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Draft carried from User Management into the Permission Builder so the reader
 * does not re-type the account they just generated SQL for.
 */

export interface AccessPrincipalDraft {
  connectionId: string;
  principalName: string;
  principalType: 'user' | 'role';
}
