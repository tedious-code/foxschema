import { getApiBase, parseJsonResponse } from './apiBase';
import type { CloudSecretProviderId } from '../lib/cloud-provider-settings';

export type AppSecretSource = 'local' | CloudSecretProviderId;

export type AppSecretCloudRef = {
  secretId: string;
  credentialId?: string;
  region?: string;
  vaultUrl?: string;
  version?: string;
};

export type AppSecretSummary = {
  id: string;
  name: string;
  source: AppSecretSource;
  hasValue: boolean;
  cloudRef: AppSecretCloudRef | null;
  updatedAt: string;
};

/** Named cloud credential (Credentials → Cloud providers). */
export type CloudProviderCredentialSummary = {
  id: string;
  name: string;
  provider: CloudSecretProviderId;
  updatedAt: string;
};

export type AwsProviderCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
};

export type GcpProviderCredentials = {
  serviceAccountJson?: string;
  accessToken?: string;
};

export type AzureProviderCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export type CloudProviderCredentials =
  | AwsProviderCredentials
  | GcpProviderCredentials
  | AzureProviderCredentials;

export async function listAppSecrets(): Promise<AppSecretSummary[]> {
  const res = await fetch(`${getApiBase()}/app-secrets`, { credentials: 'include' });
  const data = await parseJsonResponse<{ secrets: AppSecretSummary[] }>(res);
  return data.secrets ?? [];
}

export async function createAppSecret(input: {
  name: string;
  source: AppSecretSource;
  value?: string;
  cloudRef?: AppSecretCloudRef;
}): Promise<AppSecretSummary> {
  const res = await fetch(`${getApiBase()}/app-secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ secret: AppSecretSummary }>(res);
  return data.secret;
}

export async function updateAppSecret(
  id: string,
  input: {
    name?: string;
    source?: AppSecretSource;
    value?: string;
    cloudRef?: AppSecretCloudRef;
  }
): Promise<AppSecretSummary> {
  const res = await fetch(`${getApiBase()}/app-secrets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ secret: AppSecretSummary }>(res);
  return data.secret;
}

export async function deleteAppSecret(id: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/app-secrets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

export async function resolveAppSecrets(names?: string[]): Promise<{
  secrets: Record<string, string>;
  errors: Record<string, string>;
}> {
  const res = await fetch(`${getApiBase()}/app-secrets/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(names ? { names } : {}),
  });
  return parseJsonResponse(res);
}

export async function listCloudProviders(): Promise<CloudProviderCredentialSummary[]> {
  const res = await fetch(`${getApiBase()}/app-secrets/providers`, { credentials: 'include' });
  const data = await parseJsonResponse<{ providers: CloudProviderCredentialSummary[] }>(res);
  return data.providers ?? [];
}

export async function createCloudProviderCredential(input: {
  name: string;
  provider: CloudSecretProviderId;
  credentials: CloudProviderCredentials;
}): Promise<CloudProviderCredentialSummary> {
  const res = await fetch(`${getApiBase()}/app-secrets/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ provider: CloudProviderCredentialSummary }>(res);
  return data.provider;
}

export async function updateCloudProviderCredential(
  id: string,
  input: { name?: string; credentials?: CloudProviderCredentials }
): Promise<CloudProviderCredentialSummary> {
  const res = await fetch(`${getApiBase()}/app-secrets/providers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ provider: CloudProviderCredentialSummary }>(res);
  return data.provider;
}

export async function deleteCloudProviderCredential(id: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/app-secrets/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}
