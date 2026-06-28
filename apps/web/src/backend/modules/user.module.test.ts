import { describe, it, expect, beforeAll } from 'vitest';

process.env.APP_DB_PATH = ':memory:';

import { AuthModule } from './auth.module';
import { UserModule } from './user.module';

const auth = new AuthModule();
const users = new UserModule();

let userId: string;

beforeAll(async () => {
  userId = (await auth.register('pref@example.com', 'password123')).user.id;
});

describe('UserModule preferences', () => {
  it('defaults to empty prefs with onboarding incomplete', async () => {
    const p = await users.getPreferences(userId);
    expect(p).toEqual({
      role: undefined,
      primaryDatabase: undefined,
      primaryGoal: undefined,
      theme: undefined,
      onboardingCompleted: false,
    });
  });

  it('writes the full onboarding answer in one update', async () => {
    const p = await users.updatePreferences(userId, {
      role: 'DBA',
      primaryDatabase: 'DB2',
      primaryGoal: 'COMPARE_SCHEMAS',
      onboardingCompleted: true,
    });
    expect(p).toMatchObject({ role: 'DBA', primaryDatabase: 'DB2', primaryGoal: 'COMPARE_SCHEMAS', onboardingCompleted: true });
  });

  it('persists across reads', async () => {
    expect((await users.getPreferences(userId)).role).toBe('DBA');
    expect((await users.getPreferences(userId)).onboardingCompleted).toBe(true);
  });

  it('partial update preserves other fields', async () => {
    const p = await users.updatePreferences(userId, { theme: 'dark' });
    expect(p.theme).toBe('dark');
    expect(p.role).toBe('DBA'); // unchanged
    expect(p.onboardingCompleted).toBe(true); // unchanged
  });
});
