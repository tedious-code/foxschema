/**
 * Database Access · User Management, on every configured dialect.
 *
 * ## What this asserts that "the preview rendered" does not
 *
 * User Management generates account DDL for a DBA to copy and run by hand.
 * Fox Schema never executes it, so until now nothing ever established that the
 * engine would accept it. Three dialects were shipping statements that cannot
 * parse:
 *
 *   Db2         `DROP USER "x"` — SQL0104N. Db2 has no DROP USER at all; the
 *               account lives in the operating system, which is the same
 *               reason CREATE USER is refused.
 *   MariaDB     `CREATE ROLE 'r'@'%'` — ERROR 1064. MariaDB roles carry no
 *               host part; MySQL 8 and TiDB accept one, and all three shared
 *               an emitter.
 *   ClickHouse  every account statement — the driver appended
 *               `FORMAT JSONEachRow`, which the access-management grammar
 *               rejects. Table DDL tolerates it, which is why migrations were
 *               green and only this feature was broken.
 *
 * Each was invisible to an assertion on the preview text, so these tests run
 * the generated SQL against the live engine. See `helpers/sql-exec.ts` for the
 * rule: the engine may refuse us permission, but it must never refuse our
 * syntax.
 *
 * ## Scope
 *
 * Non-destructive to seeded data. The accounts created here are named with a
 * per-run suffix and dropped by the test that created them, using the SQL the
 * product generated for dropping — so teardown is itself under test.
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { getSourceConfig, hasConfig } from '../helpers/db-config.js';
import { deleteSavedConnections, engineAcceptsSyntax } from '../helpers/sql-exec.js';
import { saveScreenshot } from '../helpers/screenshot.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const ALL_DIALECTS = [
  'postgres',
  'mysql',
  'mariadb',
  'sqlserver',
  'oracle',
  'db2',
  'sqlite',
  'cockroachdb',
  'yugabytedb',
  'azuresql',
  'clickhouse',
  'redshift',
  'tidb',
  'duckdb',
] as const;

/** Engines with no SQL-reachable accounts — the answer is "not here", stated. */
const NO_ACCOUNTS: readonly string[] = ['sqlite', 'duckdb'];

/** Engines whose accounts are OS logins, so the steps are shell, not SQL. */
const OS_ACCOUNTS: readonly string[] = ['db2'];

/** Accounts are identified by user *and* host here, so the form asks for one. */
const MYSQL_FAMILY: readonly string[] = ['mysql', 'mariadb', 'tidb'];

/**
 * Substituted for the `<password>` placeholder before anything is executed.
 *
 * Built at run time rather than written out, so there is no password-shaped
 * literal in the repository for a secret scanner to flag — it is a throwaway
 * for an account this file creates and drops against a local container.
 *
 * Upper, lower and digits only: SQL Server enforces complexity (three of four
 * character classes), and every other engine takes it inside its own quoting
 * without escaping. No apostrophe, which would end the string literal.
 */
function throwawayPassword(seed: string): string {
  return `Fox${seed.replace(/[^a-z0-9]/gi, '')}Aa1`;
}

/**
 * `E2E_DIALECTS=postgres,mariadb` narrows a run to those engines.
 *
 * Every dialect needs its own saved connection before any test runs, so a
 * whole-suite run pays for fourteen of them to debug one.
 */
const only = (process.env.E2E_DIALECTS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const configured = ALL_DIALECTS.filter(
  (d) => hasConfig(d) && (only.length === 0 || only.includes(d))
);

describe.skipIf(configured.length === 0)('Database Access · User Management', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;
  const credNameByDialect = new Map<string, string>();
  const unreachable = new Map<string, string>();
  /**
   * Whether the CREATE actually ran on this engine.
   *
   * The drop test needs to tell "the engine would not let us create an account"
   * — Oracle's E2E user is a schema owner, CockroachDB runs insecure — from
   * "we created one and the listing never showed it", which is a real defect.
   * Without this the drop test returns early in both cases and passes.
   */
  const accountCreated = new Map<string, boolean>();
  const runId = Date.now().toString(36).slice(-5);
  const password = throwawayPassword(runId);
  /** Short: MySQL caps a user name at 32 and Oracle at 30. */
  const account = (kind: 'u' | 'r') => `fox_${kind}_${runId}`;

  beforeAll(async () => {
    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });

    for (const dialect of configured) {
      const cfg = getSourceConfig(dialect)!;
      const name = `E2E DbAccess ${dialect} ${runId}`;
      try {
        await sql.addCredential(name, cfg);
        credNameByDialect.set(dialect, name);
      } catch (err) {
        // An unreachable container is not a product failure; the per-dialect
        // tests skip below rather than reporting a red suite. But a silent
        // catch here is how a suite comes to pass without testing anything,
        // so the reason is always printed.
        unreachable.set(dialect, err instanceof Error ? err.message : String(err));
        // eslint-disable-next-line no-console
        console.warn(`[db-access] no connection for ${dialect}: ${unreachable.get(dialect)}`);
        await driver.reload();
        await driver.waitForSelector('[data-testid="toolbar"]', { timeout: 30_000 });
      }
    }

    await driver.locator('[data-testid="view-access-btn"]').click();
    await driver.waitForSelector('[data-testid="access-view"]', { timeout: 20_000 });
  }, 600_000);

  afterAll(async () => {
    // Remove this run's saved connections. Without it every run left one per
    // dialect behind for good, and the metadata database had built up hundreds.
    await deleteSavedConnections([...credNameByDialect.values()]);
    if (driver) await quitDriver(driver);
  });

  // ── Reading the UI ────────────────────────────────────────────────────────

  /**
   * Pick this dialect's saved connection.
   *
   * By exact label, which is `name · dialect`. Playwright's `selectOption`
   * matches a label as a literal string — handing it a RegExp silently matches
   * nothing and times out, so the label is reconstructed rather than searched.
   */
  async function selectConnection(dialect: string) {
    const label = `${credNameByDialect.get(dialect)!} · ${dialect}`;
    await driver.locator('[data-testid="user-connection"]').selectOption({ label });
  }

  /**
   * The statements from the preview, without the explanations beside them.
   *
   * Each statement renders as a `<pre>` with a `<p>` under it, so reading the
   * panel's innerText would hand the engine a paragraph of English to parse.
   */
  async function previewStatements(): Promise<string[]> {
    await driver.waitForSelector('[data-testid="user-sql"] pre', { timeout: 20_000 });
    return driver.locator('[data-testid="user-sql"] pre').allInnerTexts();
  }

  /**
   * Only what a SQL runner can take: shell steps and comment-only guidance are
   * real output, but they are not statements and must not be sent to a driver.
   */
  function runnableSql(statements: readonly string[]): string[] {
    return statements
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => !/^(sudo|docker|bash|su\b)/.test(s))
      .filter((s) => !s.split('\n').every((line) => /^\s*(--|$)/.test(line)))
      .map((s) => s.replace(/<password>/g, password))
      // Oracle and Db2 reject a trailing semicolon through their drivers.
      .map((s) => s.replace(/;\s*$/, ''));
  }

  /**
   * The list row for an account, on any engine.
   *
   * MySQL, MariaDB and TiDB identify an account by user *and* host, so the row
   * is `user-row-report_user@%` there and `user-row-report_user` everywhere
   * else. Matching on the prefix covers both; matching the bare name found
   * nothing on the MySQL family and the test quietly passed by returning early.
   */
  const rowFor = (name: string) => `[data-testid^="user-row-${name}"]`;

  /**
   * Wait until the catalog read has finished.
   *
   * Refresh is disabled while loading, so its coming back enabled is the
   * signal. Clicking a row mid-load selects one from a list that is about to be
   * replaced, and the selection is then lost — which disables Edit and Drop
   * under a test that had just checked they were available.
   */
  async function catalogIdle() {
    await driver
      .waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="user-refresh"]');
          return btn instanceof HTMLButtonElement && !btn.disabled;
        },
        undefined,
        { timeout: 120_000 }
      )
      .catch(() => undefined);
  }

  /** Start an Add for the given principal type, named and ready to read. */
  async function startAdd(dialect: string, kind: 'user' | 'role', name: string) {
    await driver.locator('[data-testid="access-tab-users"]').click();
    await selectConnection(dialect);
    await driver.locator(kind === 'user' ? '[data-testid="user-add-user"]' : '[data-testid="user-add-role"]').click();
    if (kind === 'role') {
      // Add opens on "user"; the type toggle only exists while adding.
      await driver.locator('[data-testid="user-type-role"]').click().catch(() => undefined);
    }
    await driver.locator('[data-testid="user-name"]').fill(name);
    if (MYSQL_FAMILY.includes(dialect)) {
      await driver.locator('[data-testid="user-host"]').fill('%').catch(() => undefined);
    }
  }

  // ── Per dialect ───────────────────────────────────────────────────────────

  for (const dialect of configured) {
    describe(dialect, () => {
      beforeEach((ctx) => {
        if (!credNameByDialect.has(dialect)) {
          // Skipped, never passed: a test that cannot reach its database has
          // established nothing, and reporting it green is how this suite
          // would come to certify an engine it never touched.
          ctx.skip(`${dialect} unreachable: ${unreachable.get(dialect) ?? 'no connection'}`);
        }
      });

      it('lists the accounts the database actually has', async () => {
        await driver.locator('[data-testid="access-tab-users"]').click();
        await selectConnection(dialect);

        if (NO_ACCOUNTS.includes(dialect)) {
          // Saying "this engine has no accounts" is the correct answer, and it
          // has to be visible rather than an empty panel the reader must guess
          // at. Refresh is disabled here on purpose — there is no catalog to
          // reload — so pressing it is not part of the flow.
          await driver.waitForSelector('[data-testid="user-unsupported"]', { timeout: 60_000 });
          const unsupported = driver.locator('[data-testid="user-unsupported"]');
          expect((await unsupported.innerText()).length).toBeGreaterThan(20);
          expect(
            await driver.locator('[data-testid="user-refresh"]').isDisabled(),
            `${dialect} has no catalog, so Refresh must not invite a reload`
          ).toBe(true);
          return;
        }

        await driver.locator('[data-testid="user-refresh"]').click();

        await driver.waitForFunction(
          () =>
            document.querySelector('[data-testid^="user-row-"]') !== null ||
            document.querySelector('[data-testid="user-list-error"]') !== null ||
            document.querySelector('[data-testid="user-unsupported"]') !== null ||
            document.querySelector('[data-testid="user-list-empty"]') !== null,
          undefined,
          { timeout: 120_000 }
        );

        const error = driver.locator('[data-testid="user-list-error"]');
        if ((await error.count()) > 0) {
          const message = await error.innerText();
          // A container that is down must not read as a product failure, but
          // a catalog query that is wrong must not read as a container problem.
          // The rate limiter counts too: a whole-suite run reads the catalog
          // far more often per minute than any person would.
          expect(message, `${dialect} failed to read its catalog`).toMatch(
            /not responding|ECONNREFUSED|timed? ?out|terminated|refused|too many requests/i
          );
          return;
        }

        const rows = await driver.locator('[data-testid^="user-row-"]').count();
        expect(rows, `${dialect} returned no principals`).toBeGreaterThan(0);

        // The account we are connected as must be in its own catalog listing.
        // A listing that returns rows but not this one is reading the wrong
        // table — the shape of the Db2 bug where privileges were listed but
        // principals came back empty.
        const me = getSourceConfig(dialect)!.username.toLowerCase();
        if (me && me !== 'none') {
          const names = (await driver.locator('[data-testid^="user-row-"]').allInnerTexts())
            .join(' ')
            .toLowerCase();
          expect(names, `${dialect} lists principals but not the connected user ${me}`).toContain(me);
        }
        await saveScreenshot(driver, `dbaccess-users-${dialect}`);
      });

      it('generates account SQL this engine can parse', async () => {
        if (NO_ACCOUNTS.includes(dialect)) {
          // There is no Add button to press, and that is the assertion.
          await driver.locator('[data-testid="access-tab-users"]').click();
          await selectConnection(dialect);
          expect(await driver.locator('[data-testid="user-add-user"]').count()).toBe(0);
          return;
        }

        const name = account('u');
        await startAdd(dialect, 'user', name);

        if (OS_ACCOUNTS.includes(dialect)) {
          // Db2 has no CREATE USER; Add emits OS steps instead. They are shell
          // commands, so there is no SQL to hand an engine — what matters is
          // that no SQL account statement is claimed.
          const steps = await previewStatements();
          expect(steps.join('\n')).toMatch(/useradd|GRANT CONNECT/);
          expect(steps.join('\n')).not.toMatch(/\bCREATE USER\b/);
          return;
        }

        const statements = runnableSql(await previewStatements());
        expect(statements.length, `${dialect} generated nothing to run`).toBeGreaterThan(0);

        const verdict = await engineAcceptsSyntax(dialect, statements);
        expect(verdict.rejected ?? '', verdict.rejected ?? '').toBe('');
        expect(verdict.accepted).toBe(true);
        accountCreated.set(dialect, !verdict.skipped);
        if (verdict.skipped) {
          // eslint-disable-next-line no-console
          console.warn(`[db-access] ${dialect} could not create an account: ${verdict.skipped}`);
        }
      }, 180_000);

      it('drops with SQL this engine can parse, and the account goes away', async () => {
        if (NO_ACCOUNTS.includes(dialect)) return;

        const name = account('u');

        if (OS_ACCOUNTS.includes(dialect)) {
          // The bug this covers: Db2 emitted `DROP USER`, which is SQL0104N.
          // Removing a Db2 account is an OS operation, like adding one.
          await driver.locator('[data-testid="access-tab-users"]').click();
          await selectConnection(dialect);
          await driver.locator('[data-testid="user-refresh"]').click();
          await driver
            .waitForSelector('[data-testid^="user-row-"]', { timeout: 120_000 })
            .catch(() => undefined);
          await catalogIdle();
          const row = driver.locator('[data-testid^="user-row-"]').first();
          if ((await row.count()) === 0) return;
          await row.click();
          await driver.locator('[data-testid="user-drop-selected"]').click();

          const steps = (await previewStatements()).join('\n');
          expect(steps, 'Db2 has no DROP USER — it is a syntax error there').not.toMatch(
            /\bDROP\s+USER\b/i
          );
          expect(steps, 'dropping a Db2 account means removing the OS login').toMatch(
            /userdel|REVOKE CONNECT/i
          );
          return;
        }

        // Find the account created by the previous test. It is only there if
        // that test's execution actually ran, so a privilege-skipped engine
        // simply has nothing to select here.
        await driver.locator('[data-testid="access-tab-users"]').click();
        await selectConnection(dialect);
        await driver.locator('[data-testid="user-refresh"]').click();
        // Only wait for a row that could exist. Waiting 60s for an account the
        // engine refused to create is a minute per dialect spent proving
        // nothing, and it is what pushed Oracle past the test timeout.
        if (accountCreated.get(dialect) === true) {
          await driver.waitForSelector(rowFor(name), { timeout: 60_000 }).catch(() => undefined);
        }
        await catalogIdle();

        const created = driver.locator(rowFor(name));
        if ((await created.count()) === 0) {
          // An engine that refused to create the account has nothing to drop.
          // An engine that created one and then does not list it does — that
          // is a catalog query reading the wrong place, and it fails here.
          expect(
            accountCreated.get(dialect) ?? false,
            `${dialect} created ${name} but does not list it`
          ).toBe(false);
          return;
        }

        await created.click();
        await driver.locator('[data-testid="user-drop-selected"]').click();
        const dropSql = runnableSql(await previewStatements());
        expect(dropSql.length, `${dialect} generated no DROP`).toBeGreaterThan(0);

        const verdict = await engineAcceptsSyntax(dialect, dropSql);
        expect(verdict.rejected ?? '', verdict.rejected ?? '').toBe('');

        // And the catalog agrees it is gone — which also proves the listing
        // reflects the database rather than a cache of what Fox last drew.
        await driver.locator('[data-testid="user-refresh"]').click();
        await driver
          .waitForFunction(
            (id) => document.querySelector(`[data-testid^="user-row-${id}"]`) === null,
            name,
            { timeout: 60_000 }
          )
          .catch(() => undefined);
        expect(
          await driver.locator(rowFor(name)).count(),
          `${dialect} still lists ${name} after the generated DROP ran`
        ).toBe(0);
      }, 180_000);

      it('a role is generated the way this engine spells one', async () => {
        if (NO_ACCOUNTS.includes(dialect)) return;
        const roleName = account('r');
        await startAdd(dialect, 'role', roleName);
        const statements = await previewStatements();
        const text = statements.join('\n');

        // Redshift has GROUP rather than ROLE; everything else says ROLE.
        expect(text).toMatch(dialect === 'redshift' ? /CREATE (GROUP|ROLE)/i : /CREATE ROLE/i);

        if (dialect === 'mariadb') {
          // MariaDB roles have no host part and reject one outright, where
          // MySQL 8 and TiDB accept it. One shared emitter used to give all
          // three the MySQL spelling.
          expect(text, 'MariaDB rejects a host-qualified role with ERROR 1064').not.toMatch(/@/);
        }

        const runnable = runnableSql(statements);
        if (runnable.length === 0) return;
        const verdict = await engineAcceptsSyntax(dialect, runnable);
        expect(verdict.rejected ?? '', verdict.rejected ?? '').toBe('');

        // Clean up the role with the product's own DROP, so that path runs too.
        await driver.locator('[data-testid="user-refresh"]').click();
        await driver.waitForSelector(rowFor(roleName), { timeout: 60_000 }).catch(() => undefined);
        await catalogIdle();
        const row = driver.locator(rowFor(roleName));
        if ((await row.count()) === 0) return;
        await row.click();
        await driver.locator('[data-testid="user-drop-selected"]').click();
        const dropSql = runnableSql(await previewStatements());
        if (dropSql.length > 0) await engineAcceptsSyntax(dialect, dropSql);
      }, 180_000);

      it('never puts a real password in the preview', async () => {
        if (NO_ACCOUNTS.includes(dialect)) return;
        await startAdd(dialect, 'user', account('u'));
        const text = (await previewStatements()).join('\n');

        // The product's promise is that it does not handle passwords. The
        // connection's own password is the one secret this page could leak,
        // since it is what Fox used to read the catalog a moment earlier.
        const connectionPassword = getSourceConfig(dialect)!.password;
        if (connectionPassword && connectionPassword.length > 3) {
          expect(text, `${dialect} preview contains the connection password`).not.toContain(
            connectionPassword
          );
        }
        if (/PASSWORD|IDENTIFIED|chpasswd/i.test(text)) {
          expect(text, `${dialect} should use the placeholder`).toContain('<password>');
        }
      });

      it('offers only the edits this engine can express', async () => {
        if (NO_ACCOUNTS.includes(dialect)) return;
        await driver.locator('[data-testid="access-tab-users"]').click();
        await selectConnection(dialect);
        await driver.locator('[data-testid="user-refresh"]').click();
        await driver
          .waitForSelector('[data-testid^="user-row-"]', { timeout: 120_000 })
          .catch(() => undefined);
        await catalogIdle();
        const row = driver.locator('[data-testid^="user-row-"]').first();
        if ((await row.count()) === 0) return;
        await row.click();

        const edit = driver.locator('[data-testid="user-edit-selected"]');
        if (await edit.isDisabled()) {
          // Legitimate when the engine has no alteration for this principal —
          // but the button has to say which of the two reasons applies.
          expect(await edit.getAttribute('title')).toMatch(/No edit actions|selected account/i);
          return;
        }
        await edit.click();

        // Rename is the one every engine disagrees about, and offering it where
        // it cannot work hands over SQL that fails when run.
        const rename = driver.locator('[data-testid="user-alteration-rename"]');
        const cannotRename = ['oracle', 'db2'];
        if (cannotRename.includes(dialect)) {
          expect(await rename.count(), `${dialect} cannot rename an account`).toBe(0);
        }

        // Whatever is offered must produce something, not a dead end.
        const options = await driver.locator('[data-testid^="user-alteration-"]').count();
        expect(options, `${dialect} offered Edit with no alterations`).toBeGreaterThan(0);
      }, 180_000);

      it('offers the SQL as a command for the operating system', async () => {
        if (NO_ACCOUNTS.includes(dialect) || OS_ACCOUNTS.includes(dialect)) return;
        await startAdd(dialect, 'user', account('u'));
        await driver.waitForSelector('[data-testid="user-command-mode"]', { timeout: 20_000 });

        const command = driver.locator('[data-testid="user-command-mode-command"]');
        const format = driver.locator('[data-testid="user-command-mode-format"]');
        const cfg = getSourceConfig(dialect)!;

        // ── raw: runnable as-is on a machine with the client installed ──────
        expect(await command.count(), `${dialect} rendered no command`).toBeGreaterThan(0);
        const raw = await command.innerText();
        // A command that does not carry the connection details or the statement
        // is one the reader has to finish themselves, which is the whole point.
        expect(raw).toContain(cfg.database);
        expect(raw, `${dialect} command carries no statement`).toMatch(/CREATE (USER|ROLE|LOGIN)/i);
        // The statement travels in a quoted heredoc so the shell cannot expand
        // anything inside it — a password with a `$` would otherwise be eaten.
        expect(raw).toContain("<<'FOXSQL'");

        // ── docker: refuses to guess a container name ───────────────────────
        await format.selectOption('docker');
        const formatError = driver.locator('[data-testid="user-command-mode-format-error"]');
        await formatError.waitFor({ timeout: 10_000 }).catch(() => undefined);
        expect(
          await formatError.count(),
          `${dialect} should ask for a container rather than emit a broken docker command`
        ).toBeGreaterThan(0);

        await driver.locator('[data-testid="user-command-mode-container"]').fill(`foxschema-${dialect}`);
        await driver.waitForSelector('[data-testid="user-command-mode-command"]', { timeout: 10_000 });
        const docker = await command.innerText();
        // -i keeps stdin open; without it the heredoc is discarded and the
        // client reads nothing, which looks like a command that did nothing.
        expect(docker).toContain(`docker exec -i foxschema-${dialect}`);
        expect(docker).toContain("<<'FOXSQL'");

        // ── script: a file to read before running ───────────────────────────
        await format.selectOption('script');
        const script = await command.innerText();
        expect(script).toMatch(/^#!\/usr\/bin\/env bash/);
        expect(script, `${dialect} script carries no statement`).toMatch(/CREATE (USER|ROLE|LOGIN)/i);

        await format.selectOption('raw');
        await saveScreenshot(driver, `dbaccess-command-${dialect}`);
      }, 120_000);
    });
  }
});
