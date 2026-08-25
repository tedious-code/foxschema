import { describe, expect, it } from 'vitest';
import {
  assertAzureVaultUrl,
  allowHostCloudCredentials,
  parseCloudRef,
  serializeCloudRef,
} from './cloud-secrets';

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

describe('assertAzureVaultUrl', () => {
  it('accepts public and sovereign Key Vault hostnames', () => {
    expect(() => assertAzureVaultUrl('https://myvault.vault.azure.net/')).not.toThrow();
    expect(() => assertAzureVaultUrl('https://myvault.vault.azure.cn')).not.toThrow();
    expect(() =>
      assertAzureVaultUrl('https://myvault.vault.usgovcloudapi.net/secrets')
    ).not.toThrow();
  });

  it('rejects SSRF-prone URLs', () => {
    expect(() => assertAzureVaultUrl('http://myvault.vault.azure.net/')).toThrow(/HTTPS/);
    expect(() => assertAzureVaultUrl('https://evil.example/')).toThrow(/hostname/);
    expect(() => assertAzureVaultUrl('https://127.0.0.1/')).toThrow();
    expect(() => assertAzureVaultUrl('https://169.254.169.254/')).toThrow();
    expect(() => assertAzureVaultUrl('https://attacker.vault.azure.net.evil.com/')).toThrow(
      /hostname/
    );
    expect(() => assertAzureVaultUrl('https://user:pass@myvault.vault.azure.net/')).toThrow(
      /credentials/
    );
  });
});

describe('allowHostCloudCredentials', () => {
  it('defaults to allowed (single-user)', () => {
    const prevLocal = process.env.LOCAL_SINGLE_USER;
    const prevAllow = process.env.ALLOW_HOST_CLOUD_CREDENTIALS;
    delete process.env.LOCAL_SINGLE_USER;
    delete process.env.ALLOW_HOST_CLOUD_CREDENTIALS;
    expect(allowHostCloudCredentials()).toBe(true);
    process.env.LOCAL_SINGLE_USER = 'false';
    expect(allowHostCloudCredentials()).toBe(false);
    process.env.ALLOW_HOST_CLOUD_CREDENTIALS = 'true';
    expect(allowHostCloudCredentials()).toBe(true);
    if (prevLocal === undefined) delete process.env.LOCAL_SINGLE_USER;
    else process.env.LOCAL_SINGLE_USER = prevLocal;
    if (prevAllow === undefined) delete process.env.ALLOW_HOST_CLOUD_CREDENTIALS;
    else process.env.ALLOW_HOST_CLOUD_CREDENTIALS = prevAllow;
  });
});
