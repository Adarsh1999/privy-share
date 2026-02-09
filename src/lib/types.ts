export type ItemKind = "text" | "link" | "file" | "image";

export type VaultItem = {
  id: string;
  kind: ItemKind;
  title: string | null;
  createdAt: string;
  text: string | null;
  linkUrl: string | null;
  linkNote: string | null;
  blobName: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
};

export type PublicVaultItem = Omit<VaultItem, "blobName">;

export type LockoutStatus = {
  isLocked: boolean;
  failedAttempts: number;
  maxAttempts: number;
  lockUntilEpochMs: number;
  retryAfterSeconds: number;
};
