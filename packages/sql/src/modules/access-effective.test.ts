import { describe, it, expect } from 'vitest';
import {
  permissionsForPrivilege,
  resolveEffectiveAccess,
  resolveRoleChain,
} from './access-effective';
import type { DbPrincipal, DbPrivilege } from './dialect-db-access';

const principal = (name: string, memberOf: string[] = [], members: string[] = []): DbPrincipal => ({
  name, kind: 'user', canLogin: true, memberOf, members,
});

const priv = (p: Partial<DbPrivilege> & { grantee: string; privilege: string }): DbPrivilege => ({
  objectType: 'TABLE', objectSchema: 'reporting', objectName: 'customers',
  grantable: false, grantor: null, state: 'grant', ...p,
});

describe('privilege → intent mapping', () => {
  it('maps the everyday verbs', () => {
    expect(permissionsForPrivilege('SELECT')).toEqual(['read']);
    expect(permissionsForPrivilege('DELETE')).toEqual(['delete']);
  });

  it('EXECUTE covers both routine kinds — engines do not separate them', () => {
    expect(permissionsForPrivilege('EXECUTE')).toEqual(['execute-function', 'execute-procedure']);
  });

  it.each(['ALL', 'ALL PRIVILEGES', 'CONTROL', 'DBADM'])('%s confers everything', (p) => {
    expect(permissionsForPrivilege(p)).toContain('read');
    expect(permissionsForPrivilege(p)).toContain('drop-object');
  });

  it('USAGE grants no data access on its own — the classic false positive', () => {
    // Reporting USAGE as "can read" would tell a reader they have access they
    // do not; schema usage only permits reaching in.
    expect(permissionsForPrivilege('USAGE')).toEqual([]);
  });

  it('is case- and whitespace-insensitive, and ignores what it does not know', () => {
    expect(permissionsForPrivilege('  select ')).toEqual(['read']);
    expect(permissionsForPrivilege('SOME_FUTURE_PRIVILEGE')).toEqual([]);
    expect(permissionsForPrivilege('')).toEqual([]);
  });
});

describe('role chain resolution', () => {
  const people = [
    principal('report_user', ['reporting_reader']),
    principal('reporting_reader', ['base_reader']),
    principal('base_reader', []),
  ];

  it('walks nested roles and records the path to each', () => {
    const chains = resolveRoleChain('report_user', people);
    expect(chains.get('reporting_reader')).toEqual(['reporting_reader']);
    expect(chains.get('base_reader')).toEqual(['reporting_reader', 'base_reader']);
  });

  it('terminates on a membership cycle instead of looping forever', () => {
    // Several engines permit this; an unguarded walk would hang the UI.
    const cyclic = [
      principal('a', ['b']),
      principal('b', ['c']),
      principal('c', ['a']),
    ];
    const chains = resolveRoleChain('a', cyclic);
    expect([...chains.keys()].sort()).toEqual(['b', 'c']);
  });

  it('matches names case-insensitively — Oracle and Db2 fold to upper case', () => {
    const chains = resolveRoleChain('REPORT_USER', [
      principal('report_user', ['REPORTING_READER']),
      principal('reporting_reader', []),
    ]);
    expect(chains.size).toBe(1);
  });

  it('survives a role that is referenced but not listed', () => {
    // A grant can name a role the principal probe did not return.
    const chains = resolveRoleChain('u', [principal('u', ['ghost_role'])]);
    expect(chains.get('ghost_role')).toEqual(['ghost_role']);
  });
});

describe('effective access', () => {
  const people = [
    principal('report_user', ['reporting_reader']),
    principal('reporting_reader', []),
  ];

  it('attributes a direct grant to the principal itself', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [priv({ grantee: 'report_user', privilege: 'SELECT' })],
    });
    const read = r.objects[0].permissions.find((p) => p.permission === 'read')!;
    expect(read.granted).toBe(true);
    expect(read.sources[0]).toMatchObject({ kind: 'direct', via: 'report_user', chain: [] });
  });

  it('attributes an inherited grant to the role it came through', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [priv({ grantee: 'reporting_reader', privilege: 'SELECT' })],
    });
    const read = r.objects[0].permissions.find((p) => p.permission === 'read')!;
    expect(read.granted).toBe(true);
    expect(read.sources[0]).toMatchObject({ kind: 'role', via: 'reporting_reader', chain: ['reporting_reader'] });
  });

  it('ignores grants to unrelated principals', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [priv({ grantee: 'someone_else', privilege: 'SELECT' })],
    });
    expect(r.objects).toHaveLength(0);
  });

  it('DENY beats an inherited grant, whatever order the rows arrive in', () => {
    // SQL Server's rule. Reporting this as granted would promise access the
    // server refuses.
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [
        priv({ grantee: 'reporting_reader', privilege: 'SELECT' }),
        priv({ grantee: 'report_user', privilege: 'SELECT', state: 'deny' }),
      ],
    });
    const read = r.objects[0].permissions.find((p) => p.permission === 'read')!;
    expect(read.granted).toBe(false);
    expect(read.sources.some((s) => s.kind === 'denied')).toBe(true);
    expect(r.warnings.some((w) => /DENY/.test(w))).toBe(true);
  });

  it('DENY recorded before the grant row still wins', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [
        priv({ grantee: 'report_user', privilege: 'SELECT', state: 'deny' }),
        priv({ grantee: 'reporting_reader', privilege: 'SELECT' }),
      ],
    });
    expect(r.objects[0].permissions.find((p) => p.permission === 'read')!.granted).toBe(false);
  });

  it('keeps every route to the same permission, not just the first', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [
        priv({ grantee: 'report_user', privilege: 'SELECT' }),
        priv({ grantee: 'reporting_reader', privilege: 'SELECT' }),
      ],
    });
    const read = r.objects[0].permissions.find((p) => p.permission === 'read')!;
    expect(read.sources.map((s) => s.kind).sort()).toEqual(['direct', 'role']);
  });

  it('filters to one schema when the inspector scopes to it', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people, schema: 'reporting',
      privileges: [
        priv({ grantee: 'report_user', privilege: 'SELECT' }),
        priv({ grantee: 'report_user', privilege: 'SELECT', objectSchema: 'admin', objectName: 'secrets' }),
      ],
    });
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0].schema).toBe('reporting');
  });

  it('summarises across objects — granted anywhere counts', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [
        priv({ grantee: 'report_user', privilege: 'SELECT', objectName: 'orders' }),
        priv({ grantee: 'report_user', privilege: 'INSERT', objectName: 'audit' }),
      ],
    });
    const g = (p: string) => r.summary.find((s) => s.permission === p)!.granted;
    expect(g('read')).toBe(true);
    expect(g('insert')).toBe(true);
    expect(g('delete')).toBe(false);
  });

  it('reports no writes plainly when there are none', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [priv({ grantee: 'report_user', privilege: 'SELECT' })],
    });
    expect(r.findings).toContain('No write privileges detected.');
  });

  it('flags a privilege the principal can pass on', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [priv({ grantee: 'report_user', privilege: 'SELECT', grantable: true })],
    });
    expect(r.findings.some((f) => /pass on to others/i.test(f))).toBe(true);
  });

  it('warns that schema grants hide future objects', () => {
    const r = resolveEffectiveAccess({
      principal: 'report_user', principals: people,
      privileges: [priv({ grantee: 'report_user', privilege: 'SELECT', objectType: 'SCHEMA', objectName: null })],
    });
    expect(r.warnings.some((w) => /created later/i.test(w))).toBe(true);
  });

  it('returns an empty, non-throwing result for a principal with nothing', () => {
    const r = resolveEffectiveAccess({ principal: 'nobody', principals: [], privileges: [] });
    expect(r.objects).toEqual([]);
    expect(r.summary.every((s) => !s.granted)).toBe(true);
  });
});
