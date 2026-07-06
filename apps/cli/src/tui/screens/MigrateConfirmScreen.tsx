import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { useCompare } from '../data/useCompare';
import { buildMigrationPlan } from '../data/useMigrate';
import { KeyHints } from '../components/KeyHints';
import type { ConnRef } from '../types';

interface Props {
  source: ConnRef;
  target: ConnRef;
  onConfirm: (continueOnError: boolean) => void;
  onCancel: () => void;
}

type Choice = 'run' | 'run-skip-failures' | 'cancel';

export function MigrateConfirmScreen({ source, target, onConfirm, onCancel }: Props): React.JSX.Element {
  const state = useCompare(source, target);

  if (state.status === 'loading') {
    return (
      <Box paddingX={1}>
        <Text>
          <Spinner type="dots" /> Preparing migration plan…
        </Text>
      </Box>
    );
  }

  if (state.status === 'error') {
    return (
      <Box paddingX={1}>
        <Text color="red">{state.error}</Text>
      </Box>
    );
  }

  const changed = state.data.tables.filter((t) => t.status !== 'UNCHANGED');
  if (changed.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="green">✔ Target already matches source — nothing to migrate.</Text>
      </Box>
    );
  }

  const { steps, sql } = buildMigrationPlan(changed, source, target);

  const handleSelect = (item: { value: Choice }) => {
    if (item.value === 'cancel') onCancel();
    else onConfirm(item.value === 'run-skip-failures');
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        Migrate {source.label} → {target.label} — {steps.length} change(s)
      </Text>
      <Box marginY={1} flexDirection="column">
        <Text dimColor>{sql}</Text>
      </Box>
      <SelectInput<Choice>
        items={[
          { key: 'run', label: 'Run — stop on the first failure (rolls back)', value: 'run' },
          { key: 'run-skip', label: 'Run — skip failures and continue', value: 'run-skip-failures' },
          { key: 'cancel', label: 'Cancel', value: 'cancel' },
        ]}
        onSelect={handleSelect}
      />
      <KeyHints hints={['↑↓ navigate', 'enter choose', 'esc back']} />
    </Box>
  );
}
