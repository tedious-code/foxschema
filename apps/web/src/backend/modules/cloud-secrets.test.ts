import { describe, expect, it } from 'vitest';
import { parseCloudRef, serializeCloudRef } from './cloud-secrets';

describe('cloud-secrets ref helpers', () => {
  it('round-trips cloud ref JSON', () => {
    const ref = { secretId: 'arn:aws:secretsmanager:…:secret:x', region: 'eu-west-1' };
    expect(parseCloudRef(serializeCloudRef(ref))).toEqual(ref);
  });

  it('rejects empty or invalid JSON', () => {
    expect(parseCloudRef(null)).toBeNull();
    expect(parseCloudRef('{}')).toBeNull();
    expect(parseCloudRef('not-json')).toBeNull();
  });
});
