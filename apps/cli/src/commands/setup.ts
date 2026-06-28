import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import { readConfig, writeConfig, DEFAULT_DB_PATH, CONFIG_FILE, type CliConfig } from '../runtime/config';
import { getDek, setDek, randomKeyHex } from '../runtime/keyring';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One-time (re-runnable) setup: bind an email-derived encryption key, stored in
 * the OS keychain, and record the (SQLite) database config. New installs default
 * to SQLite; switching engines is a later command.
 */
export async function runSetup(opts: { email?: string }): Promise<void> {
  const existing = readConfig();

  let email = (opts.email ?? '').trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new Error('Invalid email.');
  if (!email) {
    email = (
      await input({
        message: 'Your email (the encryption key is bound to it):',
        default: existing.email || undefined,
        validate: (v) => EMAIL_RE.test(v.trim()) || 'Enter a valid email address.',
      })
    )
      .trim()
      .toLowerCase();
  }

  let dek = getDek(email);
  let keyScheme = existing.keyScheme || 'v2';
  let created = false;
  if (!dek) {
    dek = randomKeyHex();
    try {
      setDek(email, dek); // may prompt for OS keychain access on first use
    } catch (e) {
      throw new Error(
        `Couldn't store the key in the OS keychain (${e instanceof Error ? e.message : e}). ` +
          'On a headless server, set FOXSCHEMA_KEY to a 64-hex key and skip setup.'
      );
    }
    keyScheme = 'v2';
    created = true;
  }

  const cfg: CliConfig = {
    setupComplete: true,
    email,
    dbEngine: 'sqlite',
    dbPath: existing.dbPath || DEFAULT_DB_PATH,
    dbUrl: '',
    keyScheme,
  };
  writeConfig(cfg);

  console.log();
  console.log(chalk.green.bold('✔ FoxSchema is set up.'));
  console.log(`  ${chalk.dim('email')}     ${email}`);
  console.log(
    `  ${chalk.dim('key')}       ${created ? 'generated and stored' : 'reused'} in the OS keychain ${chalk.dim('(never on disk)')}`
  );
  console.log(`  ${chalk.dim('database')}  sqlite · ${cfg.dbPath}`);
  console.log(`  ${chalk.dim('config')}    ${CONFIG_FILE}`);
  console.log();
  console.log(chalk.dim('Next: `foxschema --help`. A copied database can’t be decrypted on another machine.'));
}
