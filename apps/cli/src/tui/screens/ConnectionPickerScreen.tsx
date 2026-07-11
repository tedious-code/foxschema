import React, { useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { useConnections, resolveConnection } from '../data/useConnections';
import type { ConnRef, Role } from '../types';
import { KeyHints } from '../components/KeyHints';

interface Props {
  role: Role;
  onPicked: (ref: ConnRef) => void;
  onAddNew: () => void;
}

const ADD_NEW = '__add_new__';

export function ConnectionPickerScreen({ role, onPicked, onAddNew }: Props): React.JSX.Element {
  const state = useConnections();
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | undefined>();

  const handleSelect = async (item: { value: string }) => {
    if (item.value === ADD_NEW) {
      onAddNew();
      return;
    }
    setResolving(item.value);
    setResolveError(undefined);
    try {
      const resolved = await resolveConnection(item.value);
      if (!resolved) {
        setResolveError('That saved connection no longer exists.');
        setResolving(null);
        return;
      }
      const label =
        state.status === 'ready' ? state.data.find((c) => c.id === item.value)?.name || resolved.dialect : resolved.dialect;
      onPicked({ dialect: resolved.dialect, option: resolved.option, schema: resolved.schema ?? '', label });
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : String(e));
      setResolving(null);
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        Pick the <Text color="cyan">{role}</Text> connection
      </Text>
      {state.status === 'loading' && (
        <Text>
          <Spinner type="dots" /> Loading saved connections…
        </Text>
      )}
      {state.status === 'error' && <Text color="red">{state.error}</Text>}
      {state.status === 'ready' && !resolving && (
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...state.data.map((c) => ({
                label: `${c.name || '(unnamed)'}  [${c.dialect}]  ${[c.host, c.database, c.schema].filter(Boolean).join(' / ')}`,
                value: c.id,
              })),
              { label: '+ Add a new connection', value: ADD_NEW },
            ]}
            onSelect={handleSelect}
          />
        </Box>
      )}
      {resolving && (
        <Text>
          <Spinner type="dots" /> Connecting…
        </Text>
      )}
      {resolveError && <Text color="red">{resolveError}</Text>}
      <KeyHints hints={['↑↓ navigate', 'enter select', 'esc back']} />
    </Box>
  );
}
