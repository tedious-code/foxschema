/**
 * Data Peek row form against Postgres.
 *
 * Postgres rather than SQLite because the form's behaviour depends on catalog
 * metadata SQLite does not report: `GENERATED ... AS IDENTITY` marks the column
 * the engine fills in, and `varchar(n)` / `numeric(p,s)` carry the limits the
 * form checks values against.
 *
 * Requires the web app + API (`npm run dev`) and E2E_POSTGRES_SOURCE_* config.
 * Skips when Postgres is not configured so CI without it stays green.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Page } from 'playwright';
import { buildDriver, quitDriver } from '../helpers/driver.js';
import { getSourceConfig } from '../helpers/db-config.js';
import { AppPage } from '../pages/AppPage.js';
import { SqlEditorPage } from '../pages/SqlEditorPage.js';

const cfg = getSourceConfig('postgres');
const RUN = Date.now().toString(36);
const NAME = `E2E Peek Form ${RUN}`;
const TABLE = `e2e_peek_form_${RUN}`;
const SCHEMA = cfg?.schema ?? 'public';

function psql(sql: string): string {
  if (!cfg) throw new Error('postgres not configured');
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${cfg.password}`,
      'foxschema-postgres',
      'psql',
      '-U',
      cfg.username,
      '-d',
      cfg.database,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8' }
  );
}

describe.skipIf(!cfg)('SQL Editor · Data Peek row form', () => {
  let driver: Page;
  let app: AppPage;
  let sql: SqlEditorPage;

  beforeAll(async () => {
    // id is engine-generated; email is short + NOT NULL; amount has a scale.
    psql(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    psql(`DROP TABLE IF EXISTS ${SCHEMA}.${TABLE}`);
    psql(
      `CREATE TABLE ${SCHEMA}.${TABLE} (
         id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         email VARCHAR(12) NOT NULL,
         amount NUMERIC(6,2),
         note VARCHAR(50)
       )`
    );
    psql(`INSERT INTO ${SCHEMA}.${TABLE} (email, amount, note) VALUES ('a@b.co', 1.50, 'seed')`);

    driver = await buildDriver();
    app = new AppPage(driver);
    sql = new SqlEditorPage(driver);

    await app.open();
    await sql.resetPersistedEditorState();
    await driver.reload();
    await driver.waitForSelector('[data-testid="toolbar"]');

    await sql.addCredential(NAME, { ...cfg!, schema: SCHEMA });
    await sql.openView();
    await sql.checkConnection(NAME);
  }, 240_000);

  afterAll(async () => {
    if (driver) await quitDriver(driver);
    try {
      psql(`DROP TABLE IF EXISTS ${SCHEMA}.${TABLE}`);
    } catch {
      /* leave cleanup failures out of the report */
    }
  });

  it('locks the identity column and checks values before submitting', async () => {
    await sql.openDataPeek(TABLE);
    await sql.openPeekAddRow();

    const form = driver.locator('[data-testid="peek-row-editor"]');
    expect(await form.isVisible()).toBe(true);

    // Auto-increment column: locked, and its type is on screen.
    const id = form.locator('[data-testid="peek-row-field-id"]');
    expect(await id.isDisabled()).toBe(true);
    expect(await form.innerText()).toMatch(/integer/i);
    expect(await form.innerText()).toMatch(/character varying|varchar/i);

    // Editable columns stay editable.
    expect(await form.locator('[data-testid="peek-row-field-email"]').isDisabled()).toBe(false);

    // Over-long value for varchar(12), and a non-numeric amount.
    await form.locator('[data-testid="peek-row-field-email"]').fill('way-too-long-address@example.com');
    await form.locator('[data-testid="peek-row-field-amount"]').fill('abc');
    await driver.locator('[data-testid="peek-row-submit"]').click();

    // Submit is refused and the form stays open with per-field messages.
    expect(await form.isVisible()).toBe(true);
    await expect
      .poll(async () => form.locator('[data-testid="peek-row-error-email"]').innerText())
      .toMatch(/max 12 characters/i);
    expect(await form.locator('[data-testid="peek-row-error-amount"]').innerText()).toMatch(
      /number required/i
    );
    expect(await driver.locator('[data-testid="peek-row-error-summary"]').innerText()).toMatch(
      /2 fields/i
    );

    // Too many decimals for numeric(6,2) is caught as well.
    await form.locator('[data-testid="peek-row-field-amount"]').fill('1.234');
    await expect
      .poll(async () => form.locator('[data-testid="peek-row-error-amount"]').innerText())
      .toMatch(/2 decimal places/i);

    // Fixing both clears the errors and lets the insert through.
    await form.locator('[data-testid="peek-row-field-email"]').fill('ok@e2e.co');
    await form.locator('[data-testid="peek-row-field-amount"]').fill('12.34');
    await expect
      .poll(async () => form.locator('[data-testid="peek-row-error-email"]').count())
      .toBe(0);

    await driver.locator('[data-testid="peek-row-submit"]').click();
    await sql.confirmWriteIfShown();
    await form.waitFor({ state: 'detached', timeout: 15_000 });

    // The row landed, with an id the engine generated.
    await expect
      .poll(() => psql(`SELECT email, amount FROM ${SCHEMA}.${TABLE} WHERE email = 'ok@e2e.co'`), {
        timeout: 15_000,
      })
      .toMatch(/12\.34/);
    expect(psql(`SELECT count(*) FROM ${SCHEMA}.${TABLE} WHERE id IS NULL`)).toMatch(/\s0\s/);
  });

  it('requires a NOT NULL column with no default', async () => {
    await sql.openPeekAddRow();
    const form = driver.locator('[data-testid="peek-row-editor"]');
    await form.locator('[data-testid="peek-row-field-note"]').fill('no email given');
    await driver.locator('[data-testid="peek-row-submit"]').click();

    expect(await form.isVisible()).toBe(true);
    await expect
      .poll(async () => form.locator('[data-testid="peek-row-error-email"]').innerText())
      .toMatch(/required/i);

    // Escape abandons the draft without writing.
    await driver.keyboard.press('Escape');
    await form.waitFor({ state: 'detached', timeout: 5_000 });
    expect(psql(`SELECT count(*) FROM ${SCHEMA}.${TABLE} WHERE note = 'no email given'`)).toMatch(
      /\s0\s/
    );
  });
});
