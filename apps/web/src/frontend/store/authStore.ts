import { create } from 'zustand';
import {
  apiMe,
  apiLogin,
  apiRegister,
  apiLogout,
  apiPutPreferences,
  type AuthUser,
  type UserPreferences,
} from '../api/authApi';
type AuthStatus = 'loading' | 'anon' | 'onboarding' | 'ready';

// Single-user mode: no login required. The backend attaches a local user to
// every request automatically. Set LOCAL_SINGLE_USER=false in the environment
// to enable multi-user auth for self-hosted deployments.
const LOCAL_SINGLE_USER = true;
const LOCAL_USER: AuthUser = { id: 'local', email: 'local@foxschema.app', onboardingCompleted: true };

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  busy: boolean;

  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeOnboarding: (prefs: Partial<UserPreferences>) => Promise<void>;
  clearError: () => void;
}

function statusFor(user: AuthUser | null): AuthStatus {
  if (!user) return 'anon';
  return user.onboardingCompleted ? 'ready' : 'onboarding';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  error: null,
  busy: false,

  init: async () => {
    if (LOCAL_SINGLE_USER) {
      set({ user: LOCAL_USER, status: 'ready' });
      return;
    }
    const user = await apiMe();
    set({ user, status: statusFor(user) });
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await apiLogin(email, password);
      set({ user, status: statusFor(user), busy: false });
    } catch (e: any) {
      set({ error: e.message || 'Login failed', busy: false });
    }
  },

  register: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await apiRegister(email, password);
      set({ user, status: statusFor(user), busy: false });
    } catch (e: any) {
      set({ error: e.message || 'Registration failed', busy: false });
    }
  },

  logout: async () => {
    await apiLogout().catch(() => undefined);
    set({ user: null, status: 'anon', error: null });
  },

  completeOnboarding: async (prefs) => {
    set({ busy: true, error: null });
    try {
      await apiPutPreferences({ ...prefs, onboardingCompleted: true });
      const user = get().user;
      set({
        user: user ? { ...user, onboardingCompleted: true } : user,
        status: 'ready',
        busy: false,
      });
    } catch (e: any) {
      set({ error: e.message || 'Could not save preferences', busy: false });
    }
  },

  clearError: () => set({ error: null }),
}));
