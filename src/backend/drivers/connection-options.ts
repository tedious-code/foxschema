export interface ConnectionOptions {
  connectionString: string;

  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMs?: number;
  };

  ssl?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };

  timeout?: {
    connectMs?: number;
    queryMs?: number;
  };
}