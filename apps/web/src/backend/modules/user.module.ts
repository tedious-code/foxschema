import { getDb } from '../database/sqlite';

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
  getPreferences(userId: string): UserPreferences {
    const db = getDb();
    const prefs = db
      .prepare('SELECT role, primary_database, primary_goal, theme FROM user_preferences WHERE user_id = ?')
      .get(userId) as PrefRow | undefined;
    const user = db.prepare('SELECT onboarding_completed FROM users WHERE id = ?').get(userId) as
      | { onboarding_completed: number }
      | undefined;

    return {
      role: prefs?.role ?? undefined,
      primaryDatabase: prefs?.primary_database ?? undefined,
      primaryGoal: prefs?.primary_goal ?? undefined,
      theme: prefs?.theme ?? undefined,
      onboardingCompleted: !!user?.onboarding_completed,
    };
  }

  /** Partial update — only provided fields change; the rest are preserved. */
  updatePreferences(userId: string, input: Partial<UserPreferences>): UserPreferences {
    const db = getDb();
    const now = new Date().toISOString();
    const current = this.getPreferences(userId);

    const role = input.role ?? current.role ?? null;
    const primaryDatabase = input.primaryDatabase ?? current.primaryDatabase ?? null;
    const primaryGoal = input.primaryGoal ?? current.primaryGoal ?? null;
    const theme = input.theme ?? current.theme ?? null;

    const exists = db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(userId);
    if (exists) {
      db.prepare(
        'UPDATE user_preferences SET role = ?, primary_database = ?, primary_goal = ?, theme = ?, updated_at = ? WHERE user_id = ?'
      ).run(role, primaryDatabase, primaryGoal, theme, now, userId);
    } else {
      db.prepare(
        'INSERT INTO user_preferences (user_id, role, primary_database, primary_goal, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userId, role, primaryDatabase, primaryGoal, theme, now);
    }

    if (input.onboardingCompleted !== undefined) {
      db.prepare('UPDATE users SET onboarding_completed = ? WHERE id = ?').run(input.onboardingCompleted ? 1 : 0, userId);
    }

    return this.getPreferences(userId);
  }
}
