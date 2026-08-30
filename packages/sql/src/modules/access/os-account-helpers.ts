/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pieces for the per-dialect OS-account steps.
 */
import type { GeneratedStatement } from './access-sql.types.js';
import type { OsAccountContext, OsAccountSteps } from './os-account.types.js';

/** A Linux login name. Same rule the Db2 emitter has always applied. */
const LINUX_ACCOUNT = /^[a-z_][a-z0-9_]{0,31}$/;
const SAFE_CONTAINER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The database account name as a Linux login, or null when it cannot be one.
 *
 * Lower-cased because Linux logins conventionally are, and because the engines
 * that match an OS name to a database name compare them literally.
 */
export function asLinuxName(name: string): string | null {
  const linux = name.trim().toLowerCase();
  return LINUX_ACCOUNT.test(linux) ? linux : null;
}

/** How to reach root, given where the commands run. */
export function rootPrefix(ctx: OsAccountContext): string | { error: string } {
  if (ctx.runMode === 'server') return 'sudo ';
  const container = (ctx.container ?? '').trim();
  if (!container) return { error: 'Enter the container name to run these inside.' };
  if (!SAFE_CONTAINER.test(container)) {
    return { error: 'Container name may hold letters, digits, dot, dash and underscore.' };
  }
  return `docker exec -u 0 ${container} `;
}

/**
 * How to run a command *as* a given OS user, rather than as root.
 *
 * The two transports put the user in different places: sudo takes `-u name`
 * before the command, docker takes `-u name` before the container.
 */
export function asUserPrefix(ctx: OsAccountContext, linux: string): string | { error: string } {
  if (ctx.runMode === 'server') return `sudo -u ${linux} `;
  const container = (ctx.container ?? '').trim();
  if (!container) return { error: 'Enter the container name to run these inside.' };
  if (!SAFE_CONTAINER.test(container)) {
    return { error: 'Container name may hold letters, digits, dot, dash and underscore.' };
  }
  return `docker exec -u ${linux} ${container} `;
}

/** The answer for an engine that never consults the operating system. */
export function notApplicable(rationale: string): OsAccountSteps {
  return { applicable: false, rationale, statements: [] };
}

/**
 * `useradd` plus a check, the two steps every OS-authenticating engine needs.
 *
 * No password is set here. These accounts exist to be *matched* by name over a
 * local socket, not to be logged into, and the engines that use a password
 * take it in SQL instead.
 */
export function createLoginSteps(prefix: string, linux: string): GeneratedStatement[] {
  return [
    {
      sql: `${prefix}bash -lc 'id ${linux} >/dev/null 2>&1 || useradd -m -s /bin/bash ${linux}'`,
      explanation: `Creates the OS login ${linux}, or leaves it alone if it already exists.`,
      risk: 'elevated',
    },
    {
      sql: `${prefix}getent passwd ${linux}`,
      explanation: `Confirms the account exists. No password is set: this login is matched by name, not logged into.`,
      risk: 'low',
    },
  ];
}
