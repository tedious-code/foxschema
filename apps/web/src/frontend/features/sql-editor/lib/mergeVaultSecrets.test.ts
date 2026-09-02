import { describe, expect, it } from 'vitest';
import { mergeVaultSecretsIntoVariables } from './mergeVaultSecrets';
import type { SqlVariable } from '@/shared/lib/sql-variables';

function scalar(name: string, value: unknown, secret = false): SqlVariable {
  return {
    id: name,
    name,
    kind: 'scalar',
    value,
    secret,
    updatedAt: 1,
  };
}

describe('mergeVaultSecretsIntoVariables', () => {
  it('adds vault secrets that are not already session variables', () => {
    const session = [scalar('n', 1)];
    const merged = mergeVaultSecretsIntoVariables(session, { apiToken: 'tok', n: 'ignored' });
    expect(merged).toHaveLength(2);
    expect(merged.find((v) => v.name === 'n')?.value).toBe(1);
    const tok = merged.find((v) => v.name === 'apiToken');
    expect(tok).toMatchObject({ kind: 'scalar', value: 'tok', secret: true });
  });
});
