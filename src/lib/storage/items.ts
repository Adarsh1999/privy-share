import type { TableEntityResult } from "@azure/data-tables";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createBlobReadSasUrl, getBlobContainerClient, getItemsTableClient, initializeStorage } from "@/lib/storage/azure";
import type { ItemKind, VaultItem } from "@/lib/types";

const PARTITION_KEY = "items";

const textSchema = z.object({
  title: z.string().trim().max(120).optional(),
  text: z.string().trim().min(1).max(20000),
});

const linkSchema = z.object({
  title: z.string().trim().max(120).optional(),
  url: z.string().trim().url().max(2048),
  note: z.string().trim().max(1200).optional(),
});

type ItemEntity = {
  partitionKey: string;
  rowKey: string;
  kind: ItemKind;
  title?: string;
  text?: string;
  linkUrl?: string;
  linkNote?: string;
  blobName?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  createdAt: string;
};

const normalizeItem = (entity: TableEntityResult<Record<string, unknown>>): VaultItem => {
  const kind = String(entity.kind ?? "text") as ItemKind;
  const blobName = entity.blobName ? String(entity.blobName) : null;

  return {
    id: String(entity.rowKey),
    kind,
    title: entity.title ? String(entity.title) : null,
    createdAt: String(entity.createdAt ?? new Date().toISOString()),
    text: entity.text ? String(entity.text) : null,
    linkUrl: entity.linkUrl ? String(entity.linkUrl) : null,
    linkNote: entity.linkNote ? String(entity.linkNote) : null,
    blobName,
    fileName: entity.fileName ? String(entity.fileName) : null,
    contentType: entity.contentType ? String(entity.contentType) : null,
    sizeBytes: entity.sizeBytes == null ? null : Number(entity.sizeBytes),
    downloadUrl: blobName ? createBlobReadSasUrl(blobName) : null,
  };
};

const createRowKey = (): string => `${Date.now()}-${crypto.randomUUID()}`;

const toStoredTitle = (title: string | undefined): string | undefined => {
  if (!title) {
    return undefined;
  }

  const trimmed = title.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const sanitizeFileName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
};

export const listItems = async (): Promise<VaultItem[]> => {
  await initializeStorage();

  const itemsTableClient = getItemsTableClient();
  const entities = itemsTableClient.listEntities<Record<string, unknown>>({
    queryOptions: {
      filter: `PartitionKey eq '${PARTITION_KEY}'`,
    },
  });

  const items: VaultItem[] = [];
  for await (const entity of entities) {
    items.push(normalizeItem(entity));
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const createTextItem = async (input: { title?: string; text: string }): Promise<VaultItem> => {
  const parsed = textSchema.parse(input);

  await initializeStorage();
  const itemsTableClient = getItemsTableClient();

  const createdAt = new Date().toISOString();
  const rowKey = createRowKey();

  const entity: ItemEntity = {
    partitionKey: PARTITION_KEY,
    rowKey,
    kind: "text",
    title: toStoredTitle(parsed.title),
    text: parsed.text,
    createdAt,
  };

  await itemsTableClient.createEntity(entity);

  return normalizeItem(entity as unknown as TableEntityResult<Record<string, unknown>>);
};

export const createLinkItem = async (input: {
  title?: string;
  url: string;
  note?: string;
}): Promise<VaultItem> => {
  const parsed = linkSchema.parse(input);

  await initializeStorage();
  const itemsTableClient = getItemsTableClient();

  const createdAt = new Date().toISOString();
  const rowKey = createRowKey();

  const entity: ItemEntity = {
    partitionKey: PARTITION_KEY,
    rowKey,
    kind: "link",
    title: toStoredTitle(parsed.title),
    linkUrl: parsed.url,
    linkNote: parsed.note?.trim() || undefined,
    createdAt,
  };

  await itemsTableClient.createEntity(entity);

  return normalizeItem(entity as unknown as TableEntityResult<Record<string, unknown>>);
};

export const createFileItem = async (input: { title?: string; file: File }): Promise<VaultItem> => {
  const env = getEnv();
  const { file } = input;
  if (!file || file.size === 0) {
    throw new Error("A non-empty file is required");
  }

  const maxBytes = env.maxUploadMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File is too large. Max size is ${env.maxUploadMb}MB`);
  }

  await initializeStorage();
  const blobContainerClient = getBlobContainerClient();
  const itemsTableClient = getItemsTableClient();

  const safeName = sanitizeFileName(file.name || "file.bin");
  const blobName = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
  const blockBlobClient = blobContainerClient.getBlockBlobClient(blobName);
  const contentType = file.type || "application/octet-stream";

  const buffer = Buffer.from(await file.arrayBuffer());
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
  });

  const createdAt = new Date().toISOString();
  const rowKey = createRowKey();
  const entity: ItemEntity = {
    partitionKey: PARTITION_KEY,
    rowKey,
    kind: contentType.startsWith("image/") ? "image" : "file",
    title: toStoredTitle(input.title),
    blobName,
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    createdAt,
  };

  await itemsTableClient.createEntity(entity);

  return normalizeItem(entity as unknown as TableEntityResult<Record<string, unknown>>);
};

const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { statusCode?: number; code?: string };
  return maybe.statusCode === 404 || maybe.code === "ResourceNotFound";
};

export const deleteItemById = async (id: string): Promise<void> => {
  await initializeStorage();
  const itemsTableClient = getItemsTableClient();

  let entity: ItemEntity;
  try {
    entity = await itemsTableClient.getEntity<ItemEntity>(PARTITION_KEY, id);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }

  if (entity.blobName) {
    const blobContainerClient = getBlobContainerClient();
    await blobContainerClient.deleteBlob(entity.blobName).catch((error: unknown) => {
      if (!isNotFoundError(error)) {
        throw error;
      }
    });
  }

  await itemsTableClient.deleteEntity(PARTITION_KEY, id).catch((error: unknown) => {
    if (!isNotFoundError(error)) {
      throw error;
    }
  });
};
