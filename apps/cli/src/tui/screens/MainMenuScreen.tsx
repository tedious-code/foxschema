import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { KeyHints } from '../components/KeyHints';

export type MainMenuChoice = 'compare' | 'migrate' | 'connections' | 'history' | 'quit';

interface Props {
  onChoose: (choice: MainMenuChoice) => void;
}

export function MainMenuScreen({ onChoose }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>What would you like to do?</Text>
      <Box marginTop={1}>
        <SelectInput<MainMenuChoice>
          items={[
            { key: 'compare', label: 'Compare two schemas', value: 'compare' },
            { key: 'migrate', label: 'Migrate source → target', value: 'migrate' },
            { key: 'connections', label: 'Manage saved connections', value: 'connections' },
            { key: 'history', label: 'Migration history', value: 'history' },
            { key: 'quit', label: 'Quit', value: 'quit' },
          ]}
          onSelect={(item) => onChoose(item.value)}
        />
      </Box>
      <KeyHints hints={['↑↓ navigate', 'enter select', 'ctrl+c quit']} />
    </Box>
  );
}
