import { getEnv } from "@/lib/env";
import { getAuthTableClient, initializeStorage } from "@/lib/storage/azure";
import type { LockoutStatus } from "@/lib/types";

type AuthStateEntity = {
  partitionKey: string;
  rowKey: string;
  failedAttempts: number;
  lockUntilEpochMs: number;
  updatedAt: string;
};

const PARTITION_KEY = "auth";
const ROW_KEY = "global";

const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { statusCode?: number; code?: string };
  return maybe.statusCode === 404 || maybe.code === "ResourceNotFound";
};

const defaultEntity = (): AuthStateEntity => ({
  partitionKey: PARTITION_KEY,
  rowKey: ROW_KEY,
  failedAttempts: 0,
  lockUntilEpochMs: 0,
  updatedAt: new Date().toISOString(),
});

const normalizeEntity = (entity: Partial<AuthStateEntity>): AuthStateEntity => ({
  partitionKey: PARTITION_KEY,
  rowKey: ROW_KEY,
  failedAttempts: Number(entity.failedAttempts ?? 0),
  lockUntilEpochMs: Number(entity.lockUntilEpochMs ?? 0),
  updatedAt: String(entity.updatedAt ?? new Date().toISOString()),
});

const getEntity = async (): Promise<AuthStateEntity> => {
  await initializeStorage();
  const authTableClient = getAuthTableClient();

  try {
    const entity = await authTableClient.getEntity<AuthStateEntity>(PARTITION_KEY, ROW_KEY);
    return normalizeEntity(entity);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    const created = defaultEntity();
    await authTableClient.upsertEntity(created, "Replace");
    return created;
  }
};

const saveEntity = async (entity: AuthStateEntity): Promise<void> => {
  await initializeStorage();
  const authTableClient = getAuthTableClient();
  await authTableClient.upsertEntity(entity, "Replace");
};

const toStatus = (entity: AuthStateEntity): LockoutStatus => {
  const now = Date.now();
  const env = getEnv();
  const retryAfterSeconds = Math.max(0, Math.ceil((entity.lockUntilEpochMs - now) / 1000));

  return {
    isLocked: retryAfterSeconds > 0,
    failedAttempts: entity.failedAttempts,
    maxAttempts: env.authMaxAttempts,
    lockUntilEpochMs: entity.lockUntilEpochMs,
    retryAfterSeconds,
  };
};

export const getLockoutStatus = async (): Promise<LockoutStatus> => {
  const entity = await getEntity();
  return toStatus(entity);
};

export const recordFailedAttempt = async (): Promise<LockoutStatus> => {
  const env = getEnv();
  const entity = await getEntity();
  const now = Date.now();

  if (entity.lockUntilEpochMs > now) {
    return toStatus(entity);
  }

  let failedAttempts = entity.failedAttempts + 1;
  let lockUntilEpochMs = 0;

  if (failedAttempts >= env.authMaxAttempts) {
    failedAttempts = 0;
    lockUntilEpochMs = now + env.authLockMinutes * 60 * 1000;
  }

  const nextEntity: AuthStateEntity = {
    partitionKey: PARTITION_KEY,
    rowKey: ROW_KEY,
    failedAttempts,
    lockUntilEpochMs,
    updatedAt: new Date().toISOString(),
  };

  await saveEntity(nextEntity);
  return toStatus(nextEntity);
};

export const resetFailedAttempts = async (): Promise<void> => {
  const nextEntity: AuthStateEntity = {
    partitionKey: PARTITION_KEY,
    rowKey: ROW_KEY,
    failedAttempts: 0,
    lockUntilEpochMs: 0,
    updatedAt: new Date().toISOString(),
  };

  await saveEntity(nextEntity);
};
