import React, { useMemo, useReducer } from 'react';
import { Box, Text, useInput } from 'ink';
import { checkReady } from '../runtime/bootstrap';
import { appReducer, initialState } from './state/appReducer';
import type { ConnRef, Screen } from './types';
import { SetupRequiredScreen } from './screens/SetupRequiredScreen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { ConnectionPickerScreen } from './screens/ConnectionPickerScreen';
import { ConnectionFormScreen } from './screens/ConnectionFormScreen';
import { ConnectionManageScreen } from './screens/ConnectionManageScreen';
import { CompareScreen } from './screens/CompareScreen';
import { TableDiffDetailScreen } from './screens/TableDiffDetailScreen';
import { MigrateConfirmScreen } from './screens/MigrateConfirmScreen';
import { MigrateProgressScreen } from './screens/MigrateProgressScreen';
import { HistoryListScreen } from './screens/HistoryListScreen';
import { HistoryDetailScreen } from './screens/HistoryDetailScreen';
import { Header } from './components/Header';

const HOME: Screen = { name: 'mainMenu' };
const isHome = (s: Screen): boolean => s.name === 'mainMenu';

export default function App(): React.JSX.Element {
  const ready = useMemo(() => checkReady(), []);
  const [state, dispatch] = useReducer(appReducer, ready.ready ? HOME : { name: 'setupRequired' }, initialState);
  const screen = state.stack[state.stack.length - 1];
  const depth = state.stack.length;

  // Ctrl+C exits by Ink's own default handling (no code needed here). Escape
  // means "back one level" everywhere except at the root, where there's
  // nowhere to go — and never while ink-text-input owns a keypress, since
  // TextInput doesn't intercept escape, so this handler always sees it.
  useInput((input, key) => {
    if (key.escape && depth > 1) dispatch({ type: 'POP' });
  });

  // 'compare' walks source→target then lands on the diff browser; 'migrate'
  // walks the same two picks but goes straight to the migrate-confirm screen
  // (mirrors `fox migrate`'s dry-run-first flow without an extra detour).
  const pickedBoth = (purpose: 'compare' | 'migrate', source: ConnRef, target: ConnRef) =>
    dispatch({ type: 'PUSH', screen: purpose === 'compare' ? { name: 'compare', source, target } : { name: 'migrateConfirm', source, target } });

  let body: React.JSX.Element;
  switch (screen.name) {
    case 'setupRequired':
      body = (
        <SetupRequiredScreen
          reason={ready.ready ? 'not-set-up' : ready.reason}
          onComplete={() => dispatch({ type: 'RESET', screen: HOME })}
        />
      );
      break;

    case 'mainMenu':
      body = (
        <MainMenuScreen
          onChoose={(choice) => {
            switch (choice) {
              case 'compare':
              case 'migrate':
                dispatch({ type: 'PUSH', screen: { name: 'connectionPicker', role: 'source', purpose: choice } });
                break;
              case 'connections':
                dispatch({ type: 'PUSH', screen: { name: 'connectionManage' } });
                break;
              case 'history':
                dispatch({ type: 'PUSH', screen: { name: 'historyList' } });
                break;
              case 'quit':
                process.exit(0);
            }
          }}
        />
      );
      break;

    case 'connectionManage':
      body = <ConnectionManageScreen />;
      break;

    case 'connectionPicker':
      body = (
        <ConnectionPickerScreen
          role={screen.role}
          onPicked={(ref) =>
            screen.role === 'source'
              ? dispatch({ type: 'PUSH', screen: { name: 'connectionPicker', role: 'target', purpose: screen.purpose, source: ref } })
              : pickedBoth(screen.purpose, screen.source!, ref)
          }
          onAddNew={() =>
            dispatch({ type: 'PUSH', screen: { name: 'connectionForm', role: screen.role, purpose: screen.purpose, source: screen.source } })
          }
        />
      );
      break;

    case 'connectionForm':
      body = (
        <ConnectionFormScreen
          role={screen.role}
          onSubmit={(ref) =>
            screen.role === 'source'
              ? dispatch({ type: 'PUSH', screen: { name: 'connectionPicker', role: 'target', purpose: screen.purpose, source: ref } })
              : pickedBoth(screen.purpose, screen.source!, ref)
          }
        />
      );
      break;

    case 'compare':
      body = (
        <CompareScreen
          source={screen.source}
          target={screen.target}
          onSelectDiff={(diff) =>
            dispatch({ type: 'PUSH', screen: { name: 'tableDiffDetail', source: screen.source, target: screen.target, diff } })
          }
          onMigrate={() => dispatch({ type: 'PUSH', screen: { name: 'migrateConfirm', source: screen.source, target: screen.target } })}
        />
      );
      break;
    case 'tableDiffDetail':
      body = <TableDiffDetailScreen diff={screen.diff} />;
      break;
    case 'migrateConfirm':
      body = (
        <MigrateConfirmScreen
          source={screen.source}
          target={screen.target}
          onConfirm={(continueOnError) =>
            dispatch({ type: 'PUSH', screen: { name: 'migrateProgress', source: screen.source, target: screen.target, continueOnError } })
          }
          onCancel={() => dispatch({ type: 'POP' })}
        />
      );
      break;
    case 'migrateProgress':
      body = (
        <MigrateProgressScreen
          source={screen.source}
          target={screen.target}
          continueOnError={screen.continueOnError}
          onViewHistory={(runId) => dispatch({ type: 'PUSH', screen: { name: 'historyDetail', runId } })}
          onDone={() => dispatch({ type: 'RESET', screen: HOME })}
        />
      );
      break;
    case 'historyList':
      body = <HistoryListScreen onSelectRun={(runId) => dispatch({ type: 'PUSH', screen: { name: 'historyDetail', runId } })} />;
      break;
    case 'historyDetail':
      body = <HistoryDetailScreen runId={screen.runId} />;
      break;
  }

  return (
    <Box flexDirection="column">
      <Header />
      {body}
    </Box>
  );
}
