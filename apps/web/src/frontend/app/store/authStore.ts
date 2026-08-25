/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { create } from 'zustand';
import {
  apiMe,
  apiLogin,
  apiRegister,
  apiLogout,
  apiPutPreferences,
  apiAppConfig,
  type AuthUser,
  type UserPreferences,
} from '@/shared/api/authApi';
import type { Permission } from '@/shared/lib/permissions';
import { userCan } from '@/shared/lib/permissions';

type AuthStatus = 'loading' | 'anon' | 'onboarding' | 'ready';

const LOCAL_USER: AuthUser = {
  id: 'local',
  email: 'local@foxschema.app',
  onboardingCompleted: true,
  role: 'admin',
  permissions: [],
};

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  busy: boolean;
  /** True when the API runs in local single-user mode (no login UI). */
  localSingleUser: boolean;

  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeOnboarding: (prefs: Partial<UserPreferences>) => Promise<void>;
  refreshMe: () => Promise<void>;
  clearError: () => void;
  can: (permission: Permission) => boolean;
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
  localSingleUser: true,

  can: (permission) => userCan(get().user, permission),

  init: async () => {
    const cfg = await apiAppConfig();
    set({ localSingleUser: cfg.localSingleUser });
    await get().refreshMe();
  },

  /** Prefer the server-enriched user (real id + permissions) when available. */
  refreshMe: async () => {
    const user = await apiMe();
    if (!user && get().localSingleUser) {
      set({ user: LOCAL_USER, status: 'ready' });
      return;
    }
    set({ user, status: statusFor(user) });
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await apiLogin(email, password);
      set({ user, status: statusFor(user), busy: false });
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : 'Login failed',
        busy: false,
      });
    }
  },

  register: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await apiRegister(email, password);
      set({ user, status: statusFor(user), busy: false });
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : 'Registration failed',
        busy: false,
      });
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
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : 'Could not save preferences',
        busy: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
