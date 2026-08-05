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

  /**
   * Partial update — only provided fields are written. Theme-only saves must
   * never wipe onboarding survey answers (role / database / goal).
   */
  async updatePreferences(userId: string, input: Partial<UserPreferences>): Promise<UserPreferences> {
    const store = await getStore();
    const now = new Date().toISOString();

    const exists = await store.get('SELECT user_id FROM user_preferences WHERE user_id = ?', [userId]);
    if (exists) {
      const sets: string[] = ['updated_at = ?'];
      const params: Array<string | number | null> = [now];
      if (input.role !== undefined) {
        sets.push('role = ?');
        params.push(input.role ?? null);
      }
      if (input.primaryDatabase !== undefined) {
        sets.push('primary_database = ?');
        params.push(input.primaryDatabase ?? null);
      }
      if (input.primaryGoal !== undefined) {
        sets.push('primary_goal = ?');
        params.push(input.primaryGoal ?? null);
      }
      if (input.theme !== undefined) {
        sets.push('theme = ?');
        params.push(input.theme ?? null);
      }
      if (sets.length > 1) {
        params.push(userId);
        await store.run(`UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = ?`, params);
      }
    } else {
      await store.run(
        'INSERT INTO user_preferences (user_id, role, primary_database, primary_goal, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          userId,
          input.role ?? null,
          input.primaryDatabase ?? null,
          input.primaryGoal ?? null,
          input.theme ?? null,
          now,
        ]
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
