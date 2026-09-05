/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the builder says when it cannot build for this engine.
 *
 * The boolean here was always right. The sentence was not: it read
 * "<dialect> has no GRANT model", which is false of every engine that reaches
 * it. ClickHouse accepts `GRANT SELECT ON default.* TO user` — checked against
 * a live server — and Redis and MongoDB both enforce permissions, just not as
 * SQL. Saying the engine has no model, in a screen about permissions,
 * misinforms the reader about their own server.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PermissionBuilder } from './PermissionBuilder';

const connections = [
  { id: 'pg', name: 'PG', dialect: 'postgres', database: 'app', schema: 'public' },
  { id: 'ch', name: 'CH', dialect: 'clickhouse', database: 'default' },
  { id: 'rd', name: 'Redis', dialect: 'redis', database: '0' },
  { id: 'mg', name: 'Mongo', dialect: 'mongodb', database: 'app' },
];

vi.mock('@/app/store/useSyncStore', () => ({
  useSyncStore: (sel: (s: { connections: typeof connections }) => unknown) => sel({ connections }),
}));
vi.mock('@/app/store/useSqlEditorStore', () => ({
  useSqlEditorStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ sessionPasswords: {}, ensureSchema: vi.fn(), schemaCache: {} }),
}));
vi.mock('@/shared/api/schemaApi', () => ({
  fetchDbAccess: vi.fn().mockResolvedValue({ principals: [] }),
  fetchSchemaList: vi.fn().mockResolvedValue(['public']),
}));

const draft = (connectionId: string) => ({
  connectionId,
  principalName: 'analytics',
  principalType: 'user' as const,
});

/**
 * Rendered fresh each call — two renders in one `it` leave both in the
 * document, and the query then fails on "multiple elements found" rather than
 * telling you anything about the notice.
 */
const noticeFor = (connectionId: string) => {
  cleanup();
  render(<PermissionBuilder initialDraft={draft(connectionId)} />);
  return screen.queryByTestId('access-unsupported');
};

describe('the refusal names the right culprit', () => {
  it('blames Fox Schema for ClickHouse, which does have GRANT', () => {
    const notice = noticeFor('ch')!;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toMatch(/Fox Schema has no permission builder/i);
    // The old wording, and the reason this test exists.
    expect(notice.textContent).not.toMatch(/has no GRANT model/i);
  });

  it('names the tool for Redis and MongoDB, which have permissions elsewhere', () => {
    expect(noticeFor('rd')!.textContent).toMatch(/redis-cli/);
    expect(noticeFor('mg')!.textContent).toMatch(/mongosh/);
  });

  it('says nothing at all for an engine that works', () => {
    expect(noticeFor('pg')).toBeNull();
  });

  it('uses the engine’s proper name, not the connection’s dialect id', () => {
    // It used to interpolate `conn.dialect`, so the reader saw "clickhouse"
    // and "mongodb" in the middle of a sentence.
    expect(noticeFor('mg')!.textContent).toMatch(/MongoDB/);
    expect(noticeFor('mg')!.textContent).not.toMatch(/\bmongodb has\b/);
  });
});
