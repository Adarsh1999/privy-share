type AppEnv = {
  azureStorageConnectionString: string;
  blobContainer: string;
  itemsTable: string;
  authTable: string;
  totpSecretBase32: string;
  totpIssuer: string;
  totpAccountName: string;
  sessionSecret: string;
  sessionTtlHours: number;
  authMaxAttempts: number;
  authLockMinutes: number;
  maxUploadMb: number;
};

const required = (value: string | undefined, name: string): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const optionalNumber = (
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  name: string,
): number => {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`Invalid ${name}: expected number >= ${minimum}`);
  }

  return parsed;
};

const optionalString = (value: string | undefined, defaultValue: string): string => {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  return value;
};

let cachedEnv: AppEnv | null = null;

export const getEnv = (): AppEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  const nextEnv: AppEnv = {
    azureStorageConnectionString: required(
      process.env.AZURE_STORAGE_CONNECTION_STRING,
      "AZURE_STORAGE_CONNECTION_STRING",
    ),
    blobContainer: optionalString(process.env.AZURE_BLOB_CONTAINER, "privy-files"),
    itemsTable: optionalString(process.env.AZURE_ITEMS_TABLE, "PrivyItems"),
    authTable: optionalString(process.env.AZURE_AUTH_TABLE, "PrivyAuth"),
    totpSecretBase32: required(process.env.TOTP_SECRET_BASE32, "TOTP_SECRET_BASE32"),
    totpIssuer: optionalString(process.env.TOTP_ISSUER, "Privy Share"),
    totpAccountName: optionalString(process.env.TOTP_ACCOUNT_NAME, "owner"),
    sessionSecret: required(process.env.SESSION_SECRET, "SESSION_SECRET"),
    sessionTtlHours: optionalNumber(process.env.SESSION_TTL_HOURS, 12, 1, "SESSION_TTL_HOURS"),
    authMaxAttempts: optionalNumber(process.env.AUTH_MAX_ATTEMPTS, 10, 1, "AUTH_MAX_ATTEMPTS"),
    authLockMinutes: optionalNumber(process.env.AUTH_LOCK_MINUTES, 30, 1, "AUTH_LOCK_MINUTES"),
    maxUploadMb: optionalNumber(process.env.MAX_UPLOAD_MB, 20, 1, "MAX_UPLOAD_MB"),
  };

  if (nextEnv.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long");
  }

  cachedEnv = nextEnv;
  return cachedEnv;
};
