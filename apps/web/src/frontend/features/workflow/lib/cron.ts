/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (lib/cron.ts).
 */
import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

/** The viewer's own IANA timezone, used to show fire times in local time too. */
export const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const CRON_EXECUTION_TYPES: Record<
  'workflow' | 'http',
  { label: string; description: string }
> = {
  workflow: { label: 'Run this workflow', description: 'Start a run of the current workflow on each fire.' },
  http: { label: 'Call an HTTP endpoint', description: 'Send an HTTP request to an external service on each fire.' },
};

export function describeCron(expression: string): string {
  try {
    return cronstrue.toString(expression, { verbose: false });
  } catch {
    return 'Invalid cron expression';
  }
}

export function formatInZone(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** Next `count` fire times for a cron expression evaluated in `timezone`. */
export function computeNextRuns(
  cron: string,
  timezone: string,
  count = 5,
): Date[] | null {
  try {
    const interval = CronExpressionParser.parse(cron, { tz: timezone });
    const runs: Date[] = [];
    for (let index = 0; index < count; index += 1) {
      runs.push(interval.next().toDate());
    }
    return runs;
  } catch {
    return null;
  }
}
