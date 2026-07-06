import type { Action, Screen } from '../types';

export interface AppState {
  stack: Screen[];
}

export function initialState(home: Screen): AppState {
  return { stack: [home] };
}

/**
 * Pure stack reducer — no Ink/React involved, so it's unit-testable with plain
 * (state, action) -> state assertions. PUSH appends a screen; POP drops the top
 * one (a no-op at depth 1, since there's always a home screen to land on); RESET
 * replaces the whole stack with a fresh single home screen (used after setup
 * completes, or "back to start" from a terminal screen like migrateProgress).
 */
export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'PUSH':
      return { stack: [...state.stack, action.screen] };
    case 'POP':
      return state.stack.length <= 1 ? state : { stack: state.stack.slice(0, -1) };
    case 'RESET':
      return { stack: [action.screen] };
    default:
      return state;
  }
}
