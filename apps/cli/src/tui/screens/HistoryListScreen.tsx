import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { useHistoryList } from '../data/useHistory';
import { KeyHints } from '../components/KeyHints';

interface Props {
  onSelectRun: (runId: string) => void;
}

export function HistoryListScreen({ onSelectRun }: Props): React.JSX.Element {
  const state = useHistoryList();

  if (state.status === 'loading') {
    return (
      <Box paddingX={1}>
        <Text>
          <Spinner type="dots" /> Loading migration history…
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

  if (state.data.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No migration runs recorded.</Text>
      </Box>
    );
  }

  // ink-select-input's itemComponent only receives { label, isSelected } (not `value`),
  // so per-status color would mean parsing the status back out of the rendered label —
  // fragile for no real benefit; the status word is still visible as plain text, and the
  // detail screen (with direct control over its own <Text> elements) is where it's colored.
  const items = state.data.map((r) => ({
    key: r.id,
    label: `${r.startedAt}  ${r.status.padEnd(15)} ${r.dialect} ${r.database ?? ''}/${r.schema ?? ''}  ${r.objectCount} obj`,
    value: r.id,
  }));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Migration History</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onSelectRun(item.value)} />
      </Box>
      <KeyHints hints={['↑↓ navigate', 'enter view', 'esc back']} />
    </Box>
  );
}
