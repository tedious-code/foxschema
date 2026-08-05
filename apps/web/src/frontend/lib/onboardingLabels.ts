/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Display labels for onboarding survey answers stored in user_preferences.
 */

const GOAL_LABELS: Record<string, string> = {
  COMPARE_SCHEMAS: 'Compare schemas',
  GENERATE_SQL: 'Generate migration SQL',
  EXPLORE_DATABASE: 'Explore a database',
  CREATE_DOCUMENTATION: 'Document a schema',
};

export function goalLabel(goal?: string): string | undefined {
  if (!goal) return undefined;
  return GOAL_LABELS[goal] ?? goal;
}

/** Compact one-line summary of wizard answers, or undefined when empty. */
export function surveySummary(parts: {
  surveyRole?: string;
  primaryDatabase?: string;
  primaryGoal?: string;
}): string | undefined {
  const bits = [parts.surveyRole, parts.primaryDatabase, goalLabel(parts.primaryGoal)].filter(
    (v): v is string => !!v
  );
  return bits.length ? bits.join(' · ') : undefined;
}
