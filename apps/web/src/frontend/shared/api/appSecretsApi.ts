import { getApiBase, parseJsonResponse } from './apiBase';
import { http } from './http';
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
  const data = await http.get<{ secrets: AppSecretSummary[] }>(`/app-secrets`);
  return data.secrets ?? [];
}

export async function createAppSecret(input: {
  name: string;
  source: AppSecretSource;
  value?: string;
  cloudRef?: AppSecretCloudRef;
}): Promise<AppSecretSummary> {
  const data = await http.post<{ secret: AppSecretSummary }>(`/app-secrets`, input);
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
  const data = await http.put<{ secret: AppSecretSummary }>(`/app-secrets/${encodeURIComponent(id)}`, input);
  return data.secret;
}

export async function deleteAppSecret(id: string): Promise<void> {
  await http.delete<{ ok: boolean }>(`/app-secrets/${encodeURIComponent(id)}`);
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
  const data = await http.get<{ providers: CloudProviderCredentialSummary[] }>(`/app-secrets/providers`);
  return data.providers ?? [];
}

export async function createCloudProviderCredential(input: {
  name: string;
  provider: CloudSecretProviderId;
  credentials: CloudProviderCredentials;
}): Promise<CloudProviderCredentialSummary> {
  const data = await http.post<{ provider: CloudProviderCredentialSummary }>(`/app-secrets/providers`, input);
  return data.provider;
}

export async function updateCloudProviderCredential(
  id: string,
  input: { name?: string; credentials?: CloudProviderCredentials }
): Promise<CloudProviderCredentialSummary> {
  const data = await http.put<{ provider: CloudProviderCredentialSummary }>(`/app-secrets/providers/${encodeURIComponent(id)}`, input);
  return data.provider;
}

export async function deleteCloudProviderCredential(id: string): Promise<void> {
  await http.delete<{ ok: boolean }>(`/app-secrets/providers/${encodeURIComponent(id)}`);
}
