import React from 'react';
import { Box, Text } from 'ink';

export function Header(): React.JSX.Element {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text bold color="#F26B21">
        Fox
      </Text>
      <Text dimColor> — schema diff &amp; migration · foxschema.com</Text>
    </Box>
  );
}
