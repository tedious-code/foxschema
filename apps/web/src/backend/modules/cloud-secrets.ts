/**
 * Resolve secrets from AWS Secrets Manager / GCP Secret Manager / Azure Key Vault.
 * Prefer stored per-user provider credentials. Host default chains are only
 * allowed in single-user mode (or when ALLOW_HOST_CLOUD_CREDENTIALS=true).
 */

export type CloudSecretSource = 'aws' | 'gcp' | 'azure';

/** Ordered registry of cloud secret backends — extend when adding a provider. */
export const CLOUD_SECRET_SOURCES: readonly CloudSecretSource[] = [
  'aws',
  'gcp',
  'azure',
] as const;

export function isCloudSecretSource(value: string): value is CloudSecretSource {
  return (CLOUD_SECRET_SOURCES as readonly string[]).includes(value);
}

export type CloudSecretRef = {
  secretId: string;
  /** Named cloud credential id from Credentials → Cloud providers. */
  credentialId?: string;
  region?: string;
  vaultUrl?: string;
  version?: string;
};

/** Stored AWS access keys (optional session token + default region). */
export type AwsProviderCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
};

/** GCP service-account JSON key (full JSON string) or OAuth access token. */
export type GcpProviderCredentials = {
  serviceAccountJson?: string;
  accessToken?: string;
};

/** Azure service principal (client credentials). */
export type AzureProviderCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export type CloudProviderCredentials =
  | AwsProviderCredentials
  | GcpProviderCredentials
  | AzureProviderCredentials;

/** True when host IAM / ADC / DefaultAzureCredential may be used without user keys. */
export function allowHostCloudCredentials(): boolean {
  if (process.env.ALLOW_HOST_CLOUD_CREDENTIALS === 'true') return true;
  // LOCAL_SINGLE_USER defaults to true (desktop / personal CLI).
  return process.env.LOCAL_SINGLE_USER !== 'false';
}

/**
 * Azure Key Vault URLs only — HTTPS + known vault hostnames (blocks SSRF /
 * token exfiltration via attacker-controlled vaultUrl).
 */
export function assertAzureVaultUrl(vaultUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(vaultUrl);
  } catch {
    throw new Error('Invalid Azure Key Vault URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Azure Key Vault URL must use HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Azure Key Vault URL must not include credentials');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Azure Key Vault URL must use the default HTTPS port');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1'
  ) {
    throw new Error('Azure Key Vault URL hostname is not allowed');
  }
  // Reject raw IPv4 / IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    throw new Error('Azure Key Vault URL must use a vault hostname, not an IP');
  }
  const allowedSuffixes = [
    '.vault.azure.net',
    '.vault.azure.cn',
    '.vault.usgovcloudapi.net',
    '.vault.microsoftazure.de',
  ];
  if (!allowedSuffixes.some((sfx) => host.endsWith(sfx) && host.length > sfx.length)) {
    throw new Error(
      'Azure Key Vault URL hostname must be *.vault.azure.net (or a known sovereign-cloud vault endpoint)'
    );
  }
}

export function parseCloudRef(raw: string | null | undefined): CloudSecretRef | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CloudSecretRef>;
    if (typeof parsed.secretId !== 'string' || !parsed.secretId.trim()) return null;
    return {
      secretId: parsed.secretId.trim(),
      credentialId:
        typeof parsed.credentialId === 'string' ? parsed.credentialId.trim() || undefined : undefined,
      region: typeof parsed.region === 'string' ? parsed.region.trim() || undefined : undefined,
      vaultUrl: typeof parsed.vaultUrl === 'string' ? parsed.vaultUrl.trim() || undefined : undefined,
      version: typeof parsed.version === 'string' ? parsed.version.trim() || undefined : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeCloudRef(ref: CloudSecretRef): string {
  return JSON.stringify({
    secretId: ref.secretId,
    ...(ref.credentialId ? { credentialId: ref.credentialId } : {}),
    ...(ref.region ? { region: ref.region } : {}),
    ...(ref.vaultUrl ? { vaultUrl: ref.vaultUrl } : {}),
    ...(ref.version ? { version: ref.version } : {}),
  });
}

function requireProviderCreds(
  providerCreds: CloudProviderCredentials | undefined,
  source: CloudSecretSource
): void {
  if (providerCreds) return;
  if (allowHostCloudCredentials()) return;
  throw new Error(
    `Cloud secret resolve for ${source} requires saved Credentials → Cloud providers credentials ` +
      `(host IAM is disabled on multi-user hosts; set ALLOW_HOST_CLOUD_CREDENTIALS=true only if intentional)`
  );
}

async function resolveAws(
  ref: CloudSecretRef,
  providerCreds?: CloudProviderCredentials
): Promise<string> {
  requireProviderCreds(providerCreds, 'aws');
  let SecretsManagerClient: typeof import('@aws-sdk/client-secrets-manager').SecretsManagerClient;
  let GetSecretValueCommand: typeof import('@aws-sdk/client-secrets-manager').GetSecretValueCommand;
  try {
    const mod = await import('@aws-sdk/client-secrets-manager');
    SecretsManagerClient = mod.SecretsManagerClient;
    GetSecretValueCommand = mod.GetSecretValueCommand;
  } catch {
    throw new Error(
      'AWS Secrets Manager SDK not installed — add @aws-sdk/client-secrets-manager to the FoxSchema host'
    );
  }
  const aws = providerCreds as AwsProviderCredentials | undefined;
  const region = ref.region || aws?.region;
  const client = new SecretsManagerClient({
    ...(region ? { region } : {}),
    ...(aws?.accessKeyId && aws?.secretAccessKey
      ? {
          credentials: {
            accessKeyId: aws.accessKeyId,
            secretAccessKey: aws.secretAccessKey,
            ...(aws.sessionToken ? { sessionToken: aws.sessionToken } : {}),
          },
        }
      : {}),
  });
  const out = await client.send(
    new GetSecretValueCommand({
      SecretId: ref.secretId,
      ...(ref.version ? { VersionId: ref.version } : {}),
    })
  );
  if (typeof out.SecretString === 'string') return out.SecretString;
  if (out.SecretBinary) {
    const buf = Buffer.from(out.SecretBinary as Uint8Array);
    return buf.toString('utf8');
  }
  throw new Error(`AWS secret "${ref.secretId}" has no string/binary payload`);
}

async function resolveGcp(
  ref: CloudSecretRef,
  providerCreds?: CloudProviderCredentials
): Promise<string> {
  requireProviderCreds(providerCreds, 'gcp');
  let SecretManagerServiceClient: typeof import('@google-cloud/secret-manager').SecretManagerServiceClient;
  try {
    const mod = await import('@google-cloud/secret-manager');
    SecretManagerServiceClient = mod.SecretManagerServiceClient;
  } catch {
    throw new Error(
      'GCP Secret Manager SDK not installed — add @google-cloud/secret-manager to the FoxSchema host'
    );
  }
  const gcp = providerCreds as GcpProviderCredentials | undefined;
  const client =
    gcp?.accessToken && !gcp.serviceAccountJson
      ? new SecretManagerServiceClient({
          authClient: {
            getAccessToken: async () => ({ token: gcp.accessToken }),
            getRequestHeaders: async () => ({ Authorization: `Bearer ${gcp.accessToken}` }),
          } as never,
        })
      : new SecretManagerServiceClient(
          gcp?.serviceAccountJson
            ? { credentials: JSON.parse(gcp.serviceAccountJson) as object }
            : undefined
        );

  let name = ref.secretId;
  if (!name.includes('/versions/')) {
    name = `${name.replace(/\/$/, '')}/versions/${ref.version || 'latest'}`;
  }
  const [version] = await client.accessSecretVersion({ name });
  const data = version.payload?.data;
  if (!data) throw new Error(`GCP secret "${ref.secretId}" has empty payload`);
  if (typeof data === 'string') return data;
  return Buffer.from(data as Uint8Array).toString('utf8');
}

async function resolveAzure(
  ref: CloudSecretRef,
  providerCreds?: CloudProviderCredentials
): Promise<string> {
  if (!ref.vaultUrl) {
    throw new Error('Azure Key Vault secrets require cloud_ref.vaultUrl');
  }
  assertAzureVaultUrl(ref.vaultUrl);
  requireProviderCreds(providerCreds, 'azure');
  let SecretClient: typeof import('@azure/keyvault-secrets').SecretClient;
  let DefaultAzureCredential: typeof import('@azure/identity').DefaultAzureCredential;
  let ClientSecretCredential: typeof import('@azure/identity').ClientSecretCredential;
  try {
    const secretsMod = await import('@azure/keyvault-secrets');
    const identityMod = await import('@azure/identity');
    SecretClient = secretsMod.SecretClient;
    DefaultAzureCredential = identityMod.DefaultAzureCredential;
    ClientSecretCredential = identityMod.ClientSecretCredential;
  } catch {
    throw new Error(
      'Azure Key Vault SDKs not installed — add @azure/keyvault-secrets and @azure/identity to the FoxSchema host'
    );
  }
  const azure = providerCreds as AzureProviderCredentials | undefined;
  const credential =
    azure?.tenantId && azure?.clientId && azure?.clientSecret
      ? new ClientSecretCredential(azure.tenantId, azure.clientId, azure.clientSecret)
      : new DefaultAzureCredential();
  const client = new SecretClient(ref.vaultUrl, credential);
  const secret = await client.getSecret(ref.secretId, ref.version ? { version: ref.version } : undefined);
  if (secret.value === undefined) {
    throw new Error(`Azure secret "${ref.secretId}" has no value`);
  }
  return secret.value;
}

/** Fetch a cloud secret; callers should catch and surface the message. */
export async function resolveCloudSecret(
  source: CloudSecretSource,
  ref: CloudSecretRef,
  providerCreds?: CloudProviderCredentials
): Promise<string> {
  if (source === 'aws') return resolveAws(ref, providerCreds);
  if (source === 'gcp') return resolveGcp(ref, providerCreds);
  if (source === 'azure') return resolveAzure(ref, providerCreds);
  throw new Error(`Unknown cloud secret source: ${source}`);
}
