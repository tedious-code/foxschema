import { describe, it, expect } from 'vitest';
import {
  buildAccessSql,
  invertAccessRequest,
  type GeneratedPermissionSql,
} from './access-sql';
import {
  accessCapabilities,
  availablePermissions,
  highestRisk,
  permissionsForPreset,
  presetForPermissions,
  supportsAccessBuilder,
  type PermissionRequest,
} from './intent';

const user = { type: 'user' as const, name: 'report_user' };

function ok(req: PermissionRequest, dialect: string): GeneratedPermissionSql {
  const r = buildAccessSql(req, dialect);
  if ('error' in r) throw new Error(`${dialect}: ${r.error}`);
  return r;
}
const sqlOf = (r: GeneratedPermissionSql) => r.statements.map((s) => s.sql).join('\n');

describe('PostgreSQL generation', () => {
  it('read on a schema needs USAGE before SELECT — the prerequisite a reader should not have to know', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'reporting' } },
      'postgres'
    );
    const sql = sqlOf(r);
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA "reporting" TO "report_user";/);
    expect(sql).toMatch(/GRANT SELECT ON ALL TABLES IN SCHEMA "reporting" TO "report_user";/);
    // USAGE must come first: the SELECT grant is inert without it.
    expect(sql.indexOf('USAGE')).toBeLessThan(sql.indexOf('ALL TABLES'));
  });

  it('revoking SELECT on one table does not strip schema USAGE other grants need', () => {
    const r = ok(
      {
        principal: user,
        action: 'revoke',
        permissions: ['read'],
        scope: { type: 'tables', schema: 'reporting', tables: ['customers'] },
      },
      'postgres'
    );
    const sql = sqlOf(r);
    expect(sql).toMatch(/REVOKE SELECT ON "reporting"\."customers" FROM "report_user";/);
    expect(sql).not.toMatch(/REVOKE USAGE ON SCHEMA/i);
  });

  it('revoking schema-wide access still removes USAGE', () => {
    const r = ok(
      {
        principal: user,
        action: 'revoke',
        permissions: ['read'],
        scope: { type: 'schema', schema: 'reporting' },
      },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(/REVOKE USAGE ON SCHEMA "reporting" FROM "report_user";/);
  });

  it('future tables add ALTER DEFAULT PRIVILEGES, and say whose objects it covers', () => {
    const r = ok(
      {
        principal: user, action: 'grant', permissions: ['read'],
        scope: { type: 'schema', schema: 'reporting' }, includeFutureObjects: true,
      },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA "reporting" GRANT SELECT ON TABLES TO "report_user";/
    );
    // The ownership caveat is the thing that trips people up in production.
    expect(r.warnings.some((w) => /only applies to objects created by the role/i.test(w.message))).toBe(true);
  });

  it('read/write on a schema grants all four verbs in one statement', () => {
    const r = ok(
      {
        principal: user, action: 'grant',
        permissions: ['read', 'insert', 'update', 'delete'],
        scope: { type: 'schema', schema: 'reporting' },
      },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  });

  it('one statement per table at table scope', () => {
    const r = ok(
      {
        principal: user, action: 'grant', permissions: ['read'],
        scope: { type: 'tables', schema: 'public', tables: ['orders', 'customers'] },
      },
      'postgres'
    );
    expect(r.statements.filter((s) => !s.sql.startsWith('--'))).toHaveLength(3); // USAGE + 2 tables
    expect(sqlOf(r)).toMatch(/ON "public"\."orders"/);
    expect(sqlOf(r)).toMatch(/ON "public"\."customers"/);
  });

  it('says ALTER and DROP are ownership, not privileges — instead of emitting SQL that will not work', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['drop-object'], scope: { type: 'schema', schema: 'app' } },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(/no ALTER or DROP privilege/);
    expect(r.risk).toBe('critical');
  });

  it('revoke mirrors the grant', () => {
    const r = ok(
      { principal: user, action: 'revoke', permissions: ['read'], scope: { type: 'schema', schema: 'reporting' } },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(/REVOKE SELECT ON ALL TABLES IN SCHEMA "reporting" FROM "report_user";/);
    expect(r.warnings.some((w) => /inherited through a role/i.test(w.message))).toBe(true);
  });
});

describe('MySQL generation', () => {
  it('database read uses db.* and notes that future tables are included', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'database', database: 'sales' } },
      'mysql'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT ON `sales`\.\* TO/);
    expect(r.statements[0].explanation).toMatch(/including tables created later/i);
  });

  it('a user@host principal keeps its host', () => {
    const r = ok(
      {
        principal: { type: 'user', name: 'report_user@10.0.0.5' }, action: 'grant',
        permissions: ['read'], scope: { type: 'database', database: 'sales' },
      },
      'mysql'
    );
    expect(sqlOf(r)).toContain(`'report_user'@'10.0.0.5'`);
  });

  it('offers no schema scope — database and schema are one thing', () => {
    expect(accessCapabilities('mysql').schemaScope).toBe(false);
    const r = buildAccessSql(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'sales' } },
      'mysql'
    );
    expect('error' in r && /no schema-level grants/i.test(r.error)).toBe(true);
  });
});

describe('SQL Server generation', () => {
  it('schema read uses SCHEMA:: and explains that future objects are covered', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'reporting' } },
      'sqlserver'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT ON SCHEMA::\[reporting\] TO \[report_user\];/);
    expect(r.statements[0].explanation).toMatch(/including objects added later/i);
  });

  it('table scope targets OBJECT::', () => {
    const r = ok(
      {
        principal: user, action: 'grant', permissions: ['read'],
        scope: { type: 'tables', schema: 'dbo', tables: ['Orders'] },
      },
      'sqlserver'
    );
    expect(sqlOf(r)).toMatch(/ON OBJECT::\[dbo\]\.\[Orders\]/);
  });

  it('azuresql behaves as sqlserver', () => {
    expect(sqlOf(ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'reporting' } },
      'azuresql'
    ))).toMatch(/SCHEMA::/);
  });
});

describe('Db2 and Oracle', () => {
  it('Db2 names the grantee as USER or ROLE', () => {
    const r = ok(
      {
        principal: { type: 'user', name: 'REPORT_USER' }, action: 'grant', permissions: ['read'],
        scope: { type: 'tables', schema: 'REPORTING', tables: ['SALES'] },
      },
      'db2'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT ON TABLE "REPORTING"\."SALES" TO USER "REPORT_USER";/);
  });

  it('Db2 refuses to invent a schema-wide table grant', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'REPORTING' } },
      'db2'
    );
    expect(sqlOf(r)).toMatch(/^--/m);
    expect(r.statements.some((s) => /no schema-wide table grant/i.test(s.explanation))).toBe(true);
  });

  it('Oracle calls connecting CREATE SESSION', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['connect'], scope: { type: 'database', database: 'ORCL' } },
      'oracle'
    );
    expect(sqlOf(r)).toMatch(/GRANT CREATE SESSION TO/);
  });
});

describe('capabilities keep the UI honest', () => {
  it('engines with no GRANT model are excluded outright', () => {
    for (const d of ['sqlite', 'duckdb', 'clickhouse']) {
      expect(supportsAccessBuilder(d)).toBe(false);
    }
  });

  it('postgres-wire engines inherit the postgres model', () => {
    for (const d of ['cockroachdb', 'yugabytedb', 'redshift']) {
      expect(sqlOf(ok(
        { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'app' } },
        d
      ))).toMatch(/GRANT USAGE ON SCHEMA/);
    }
  });

  it('future objects are refused where they cannot be expressed, not silently dropped', () => {
    const r = buildAccessSql(
      {
        principal: user, action: 'grant', permissions: ['read'],
        scope: { type: 'tables', schema: 'dbo', tables: ['Orders'] }, includeFutureObjects: true,
      },
      'sqlserver'
    );
    expect('error' in r).toBe(true);
  });

  it('connect is only offered where it is a real privilege at database scope', () => {
    expect(availablePermissions('postgres', 'database')).toContain('connect');
    expect(availablePermissions('postgres', 'schema')).not.toContain('connect');
    // MySQL has no CONNECT privilege — reaching the server is the account itself.
    expect(availablePermissions('mysql', 'database')).not.toContain('connect');
  });
});

describe('presets and risk', () => {
  it('round-trip: a preset maps to permissions and back', () => {
    for (const p of ['read-only', 'read-write', 'application-writer', 'procedure-executor', 'schema-developer'] as const) {
      expect(presetForPermissions(permissionsForPreset(p))).toBe(p);
    }
  });

  it('application-writer deliberately withholds delete', () => {
    expect(permissionsForPreset('application-writer')).not.toContain('delete');
    expect(permissionsForPreset('read-write')).toContain('delete');
  });

  it('risk climbs with what the permission can destroy', () => {
    expect(highestRisk(['read'])).toBe('low');
    expect(highestRisk(['read', 'insert'])).toBe('elevated');
    expect(highestRisk(['create-object'])).toBe('administrative');
    expect(highestRisk(['drop-object'])).toBe('critical');
  });

  it('grant option outranks whatever it is attached to', () => {
    // Read is low risk; the ability to pass it on to anyone is not.
    expect(highestRisk(['read'], true)).toBe('critical');
  });

  it('destructive permissions raise a danger warning', () => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'app' }, withGrantOption: true },
      'postgres'
    );
    expect(r.warnings.some((w) => w.level === 'danger')).toBe(true);
    expect(sqlOf(r)).toMatch(/WITH GRANT OPTION/);
  });
});

describe('identifier safety', () => {
  it.each([
    ['a name with spaces', 'my schema'],
    ['a reserved word', 'select'],
    ['an embedded double quote', 'we"ird'],
    ['a hyphen', 'report-user'],
  ])('quotes %s rather than concatenating it raw', (_label, name) => {
    const r = ok(
      { principal: user, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: name } },
      'postgres'
    );
    const sql = sqlOf(r);
    // The bare identifier must never appear unquoted next to a keyword.
    expect(sql).toMatch(/ON SCHEMA "/);
    expect(sql).not.toMatch(new RegExp(`SCHEMA ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  });

  it('a quote in a principal name cannot break out of the statement', () => {
    const r = ok(
      { principal: { type: 'user', name: 'ev"il' }, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'app' } },
      'postgres'
    );
    // Doubled, so the identifier stays one token.
    expect(sqlOf(r)).toContain('"ev""il"');
  });

  it('rejects an empty principal instead of generating a dangling grant', () => {
    const r = buildAccessSql(
      { principal: { type: 'user', name: '  ' }, action: 'grant', permissions: ['read'], scope: { type: 'schema', schema: 'app' } },
      'postgres'
    );
    expect('error' in r).toBe(true);
  });
});

describe('invertAccessRequest', () => {
  it('flips grant to revoke and drops the grant option', () => {
    const req: PermissionRequest = {
      principal: user, action: 'grant', permissions: ['read'],
      scope: { type: 'schema', schema: 'app' }, withGrantOption: true,
    };
    const inv = invertAccessRequest(req);
    expect(inv.action).toBe('revoke');
    expect(inv.withGrantOption).toBe(false);
    expect(sqlOf(ok(inv, 'postgres'))).toMatch(/REVOKE SELECT ON ALL TABLES/);
    expect(sqlOf(ok(inv, 'postgres'))).not.toMatch(/WITH GRANT OPTION/);
  });

  it('deny inverts to revoke for undo', () => {
    const req: PermissionRequest = {
      principal: user,
      action: 'deny',
      permissions: ['read'],
      scope: { type: 'schema', schema: 'reporting' },
    };
    expect(invertAccessRequest(req).action).toBe('revoke');
  });
});

describe('Phase C — columns, sequences, DENY', () => {
  it('postgres column read uses parenthesized column list', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['read'],
        scope: { type: 'columns', schema: 'public', table: 'orders', columns: ['id', 'total'] },
      },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT \("id", "total"\) ON "public"\."orders"/);
  });

  it('postgres sequence usage on named sequences', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['use-sequence'],
        scope: { type: 'sequences', schema: 'public', sequences: ['orders_id_seq'] },
      },
      'postgres'
    );
    expect(sqlOf(r)).toMatch(/GRANT USAGE ON SEQUENCE "public"\."orders_id_seq"/);
  });

  it('mysql column grant', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['read', 'update'],
        scope: { type: 'columns', schema: 'sales', table: 'orders', columns: ['status'] },
      },
      'mysql'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT, UPDATE \(`status`\) ON `sales`\.`orders`/);
  });

  it('sql server DENY uses DENY … TO', () => {
    const r = ok(
      {
        principal: user,
        action: 'deny',
        permissions: ['delete'],
        scope: { type: 'tables', schema: 'dbo', tables: ['Orders'] },
      },
      'sqlserver'
    );
    expect(sqlOf(r)).toMatch(/DENY DELETE ON OBJECT::\[dbo\]\.\[Orders\] TO \[report_user\]/);
  });

  it('sql server column deny', () => {
    const r = ok(
      {
        principal: user,
        action: 'deny',
        permissions: ['read'],
        scope: { type: 'columns', schema: 'dbo', table: 'Orders', columns: ['Salary'] },
      },
      'sqlserver'
    );
    expect(sqlOf(r)).toMatch(/DENY SELECT ON OBJECT::\[dbo\]\.\[Orders\] \(\[Salary\]\) TO/);
  });

  it('deny is refused on postgres', () => {
    const r = buildAccessSql(
      {
        principal: user,
        action: 'deny',
        permissions: ['read'],
        scope: { type: 'schema', schema: 'app' },
      },
      'postgres'
    );
    expect('error' in r && /no DENY/i.test(r.error)).toBe(true);
  });

  it('column scope is gated by capability', () => {
    expect(accessCapabilities('postgres').columnScope).toBe(true);
    expect(accessCapabilities('db2').columnScope).toBe(false);
    expect(availablePermissions('postgres', 'columns')).toEqual(['read', 'insert', 'update']);
  });
});

describe('access-sql registry', () => {
  it('aliases azuresql to sqlserver grant shape', () => {
    const req: PermissionRequest = {
      principal: user,
      action: 'grant',
      permissions: ['read'],
      scope: { type: 'tables', schema: 'dbo', tables: ['Orders'] },
    };
    expect(sqlOf(ok(req, 'azuresql'))).toBe(sqlOf(ok(req, 'sqlserver')));
  });

  it('aliases mariadb and tidb to mysql grant shape', () => {
    const req: PermissionRequest = {
      principal: user,
      action: 'grant',
      permissions: ['read'],
      scope: { type: 'tables', schema: 'sales', tables: ['orders'] },
    };
    expect(sqlOf(ok(req, 'mariadb'))).toBe(sqlOf(ok(req, 'mysql')));
    expect(sqlOf(ok(req, 'tidb'))).toBe(sqlOf(ok(req, 'mysql')));
  });

  it('aliases cockroachdb and yugabytedb to postgres grant shape', () => {
    const req: PermissionRequest = {
      principal: user,
      action: 'grant',
      permissions: ['read'],
      scope: { type: 'schema', schema: 'reporting' },
    };
    expect(sqlOf(ok(req, 'cockroachdb'))).toBe(sqlOf(ok(req, 'postgres')));
    expect(sqlOf(ok(req, 'yugabytedb'))).toBe(sqlOf(ok(req, 'postgres')));
  });
});

describe('a commented-out template does not count as granting anything', () => {
  // Reported from a live Oracle test: "read only" at database scope produced a
  // runnable GRANT CREATE SESSION and a commented "repeat for each table"
  // block, with no warning. Pasting it gave the account login and no read
  // access at all. The template was passing itself off as covering SELECT,
  // which silenced the warning built for exactly this case.
  it('warns that Oracle read is not granted at database scope', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['connect', 'read'],
        scope: { type: 'database', database: 'FREEPDB1' },
      },
      'oracle'
    );
    const sql = sqlOf(r);
    expect(sql).toMatch(/GRANT CREATE SESSION/);
    // The only runnable line is the session grant; the rest is a comment.
    const runnable = sql
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('--'));
    expect(runnable).toHaveLength(1);

    const warned = r.warnings.map((w) => w.message).join(' ');
    expect(warned).toMatch(/cannot express read data/i);
    expect(warned).toMatch(/switch the scope to tables/i);
  });

  it('warns the same way on Db2', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['read'],
        scope: { type: 'schema', schema: 'DEMO_A' },
      },
      'db2'
    );
    expect(r.warnings.map((w) => w.message).join(' ')).toMatch(/cannot express read data/i);
  });

  it('warns that PostgreSQL alter and drop are ownership, not grants', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['alter-object', 'drop-object'],
        scope: { type: 'schema', schema: 'reporting' },
      },
      'postgres'
    );
    const warned = r.warnings.map((w) => w.message).join(' ');
    expect(warned).toMatch(/cannot express/i);
    // Not a table privilege, so the "pick tables" advice would be wrong here.
    expect(warned).toMatch(/ownership/i);
  });

  it('still reports nothing when the grant really is expressible', () => {
    const r = ok(
      {
        principal: user,
        action: 'grant',
        permissions: ['read'],
        scope: { type: 'tables', schema: 'DEMO_A', tables: ['ORDERS'] },
      },
      'oracle'
    );
    expect(sqlOf(r)).toMatch(/GRANT SELECT ON "DEMO_A"\."ORDERS"/);
    expect(r.warnings.map((w) => w.message).join(' ')).not.toMatch(/cannot express/i);
  });
});
