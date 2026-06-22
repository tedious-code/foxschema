import { getStore } from '../database/store';

export interface UserPreferences {
  role?: string;
  primaryDatabase?: string;
  primaryGoal?: string;
  theme?: string;
  onboardingCompleted: boolean;
}

interface PrefRow {
  role: string | null;
  primary_database: string | null;
  primary_goal: string | null;
  theme: string | null;
}

/**
 * User profile / onboarding state. Profile fields live in `user_preferences`;
 * `onboardingCompleted` lives on `users` (it's an account-level flag).
 */
export class UserModule {
  async getPreferences(userId: string): Promise<UserPreferences> {
    const store = await getStore();
    const prefs = await store.get<PrefRow>(
      'SELECT role, primary_database, primary_goal, theme FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    const user = await store.get<{ onboarding_completed: number }>(
      'SELECT onboarding_completed FROM users WHERE id = ?',
      [userId]
    );

    return {
      role: prefs?.role ?? undefined,
      primaryDatabase: prefs?.primary_database ?? undefined,
      primaryGoal: prefs?.primary_goal ?? undefined,
      theme: prefs?.theme ?? undefined,
      onboardingCompleted: !!user?.onboarding_completed,
    };
  }

  /** Partial update — only provided fields change; the rest are preserved. */
  async updatePreferences(userId: string, input: Partial<UserPreferences>): Promise<UserPreferences> {
    const store = await getStore();
    const now = new Date().toISOString();
    const current = await this.getPreferences(userId);

    const role = input.role ?? current.role ?? null;
    const primaryDatabase = input.primaryDatabase ?? current.primaryDatabase ?? null;
    const primaryGoal = input.primaryGoal ?? current.primaryGoal ?? null;
    const theme = input.theme ?? current.theme ?? null;

    const exists = await store.get('SELECT user_id FROM user_preferences WHERE user_id = ?', [userId]);
    if (exists) {
      await store.run(
        'UPDATE user_preferences SET role = ?, primary_database = ?, primary_goal = ?, theme = ?, updated_at = ? WHERE user_id = ?',
        [role, primaryDatabase, primaryGoal, theme, now, userId]
      );
    } else {
      await store.run(
        'INSERT INTO user_preferences (user_id, role, primary_database, primary_goal, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, role, primaryDatabase, primaryGoal, theme, now]
      );
    }

    if (input.onboardingCompleted !== undefined) {
      await store.run('UPDATE users SET onboarding_completed = ? WHERE id = ?', [
        input.onboardingCompleted ? 1 : 0,
        userId,
      ]);
    }

    return this.getPreferences(userId);
  }
}
