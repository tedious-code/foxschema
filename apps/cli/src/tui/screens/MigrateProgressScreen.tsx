import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { useCompare } from '../data/useCompare';
import { useMigrate, buildMigrationPlan } from '../data/useMigrate';
import { StatusBadge } from '../components/StatusBadge';
import { KeyHints } from '../components/KeyHints';
import type { ConnRef } from '../types';

interface Props {
  source: ConnRef;
  target: ConnRef;
  continueOnError: boolean;
  onViewHistory: (runId: string) => void;
  onDone: () => void;
}

/** Live per-object progress while a migration runs, then a terminal summary. */
export function MigrateProgressScreen({ source, target, continueOnError, onViewHistory, onDone }: Props): React.JSX.Element {
  const compareState = useCompare(source, target);
  const changed = compareState.status === 'ready' ? compareState.data.tables.filter((t) => t.status !== 'UNCHANGED') : undefined;

  // Computed once the plan is available — buildMigrationPlan is deterministic over `changed`,
  // memoized so re-renders (triggered by useMigrate's own progress updates) don't recompute it.
  const plan = useMemo(() => (changed ? buildMigrationPlan(changed, source, target) : null), [changed, source, target]);

  if (compareState.status === 'loading' || !plan) {
    return (
      <Box paddingX={1}>
        <Text>
          <Spinner type="dots" /> Preparing…
        </Text>
      </Box>
    );
  }
  if (compareState.status === 'error') {
    return (
      <Box paddingX={1}>
        <Text color="red">{compareState.error}</Text>
      </Box>
    );
  }

  return (
    <MigrationRunner source={source} target={target} steps={plan.steps} sql={plan.sql} continueOnError={continueOnError} onViewHistory={onViewHistory} onDone={onDone} />
  );
}

function MigrationRunner({
  target,
  steps,
  sql,
  continueOnError,
  onViewHistory,
  onDone,
}: Props & { steps: ReturnType<typeof buildMigrationPlan>['steps']; sql: string }): React.JSX.Element {
  const { results, outcome, runId } = useMigrate(target, steps, sql, continueOnError);

  const done = outcome.status !== 'running';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Migrating {steps.length} change(s)…</Text>
      <Box flexDirection="column" marginTop={1}>
        {results.map((r) => (
          <Text key={r.name}>
            {r.status === 'RUNNING' ? (
              <Text>
                <Spinner type="dots" />
              </Text>
            ) : (
              <StatusBadge status={r.status === 'SUCCESS' ? 'ADDED' : r.status === 'SKIPPED' ? 'MODIFIED' : 'REMOVED'} />
            )}{' '}
            {r.action} {r.type} {r.name}
            {r.error && <Text color="red"> — {r.error}</Text>}
          </Text>
        ))}
      </Box>

      {outcome.status === 'success' && <Text color="green">✔ Migration applied ({steps.length} change(s)).</Text>}
      {outcome.status === 'partial_success' && (
        <Text color="yellow">⚠ Completed with {outcome.failedCount} failure(s) — skipped and continued.</Text>
      )}
      {outcome.status === 'failed' && <Text color="red">✗ Migration failed{outcome.error ? `: ${outcome.error}` : ''}</Text>}
      {outcome.status === 'rolled_back' && <Text color="red">✗ Migration rolled back{outcome.error ? `: ${outcome.error}` : ''}</Text>}

      {done && (
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...(runId ? [{ key: 'history', label: 'View in history', value: 'history' }] : []),
              { key: 'done', label: 'Back to start', value: 'done' },
            ]}
            onSelect={(item) => (item.value === 'history' && runId ? onViewHistory(runId) : onDone())}
          />
        </Box>
      )}
      <KeyHints hints={done ? ['enter select', 'esc back'] : ['running…']} />
    </Box>
  );
}
