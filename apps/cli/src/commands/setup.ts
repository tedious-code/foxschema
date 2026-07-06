import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import { readConfig, CONFIG_FILE } from '../runtime/config';
import { performSetup, EMAIL_RE } from '../runtime/setup';

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

  let cfg, created;
  try {
    ({ cfg, created } = performSetup(email));
  } catch (e) {
    throw new Error(
      `Couldn't store the key in the OS keychain (${e instanceof Error ? e.message : e}). ` +
        'On a headless server, set FOXSCHEMA_KEY to a 64-hex key and skip setup.'
    );
  }

  console.log();
  console.log(chalk.green.bold('✔ Fox is set up.'));
  console.log(`  ${chalk.dim('email')}     ${email}`);
  console.log(
    `  ${chalk.dim('key')}       ${created ? 'generated and stored' : 'reused'} in the OS keychain ${chalk.dim('(never on disk)')}`
  );
  console.log(`  ${chalk.dim('database')}  sqlite · ${cfg.dbPath}`);
  console.log(`  ${chalk.dim('config')}    ${CONFIG_FILE}`);
  console.log();
  console.log(chalk.dim('Next: `fox --help`. A copied database can’t be decrypted on another machine.'));
}
