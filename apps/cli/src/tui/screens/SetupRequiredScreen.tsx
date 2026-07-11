import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { performSetup, EMAIL_RE } from '../../runtime/setup';
import { friendlyError } from '../../format/friendlyError';

interface Props {
  reason: 'not-set-up' | 'key-unreachable';
  onComplete: () => void;
}

/**
 * Shown instead of crashing the interactive session when checkReady() fails.
 * 'key-unreachable' isn't fixable from here (the key lives in the OS keychain
 * or FOXSCHEMA_KEY env, neither of which a TUI screen can repair) — only
 * 'not-set-up' offers the inline email-entry flow, backed by the same
 * performSetup() the line `fox setup` command uses.
 */
export function SetupRequiredScreen({ reason, onComplete }: Props): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (reason === 'key-unreachable') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow" bold>
          Encryption key unavailable
        </Text>
        <Text>The keychain is locked, or this install moved to a different machine.</Text>
        <Text>
          Re-run <Text bold>fox setup</Text> outside the TUI, or set{' '}
          <Text bold>FOXSCHEMA_KEY</Text> for headless use, then relaunch.
        </Text>
      </Box>
    );
  }

  const submit = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      performSetup(trimmed);
      onComplete();
    } catch (e) {
      setBusy(false);
      setError(friendlyError(e));
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="green">
        Welcome to Fox
      </Text>
      <Text dimColor>This install isn't set up yet. Your email binds the encryption key stored in the OS keychain.</Text>
      <Box marginTop={1}>
        <Text>Email: </Text>
        <TextInput value={email} onChange={setEmail} onSubmit={submit} />
      </Box>
      {busy && <Text dimColor>Setting up…</Text>}
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
