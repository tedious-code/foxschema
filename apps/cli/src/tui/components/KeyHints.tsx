import React from 'react';
import { Box, Text } from 'ink';

/** Bottom-of-screen key-hint bar. Screens pass their own local hints; `esc back` is added automatically when depth > 1 (App.tsx owns that). */
export function KeyHints({ hints }: { hints: string[] }): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text dimColor>{hints.join(' · ')}</Text>
    </Box>
  );
}
