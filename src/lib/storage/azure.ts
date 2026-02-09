import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { getEnv } from "@/lib/env";

type AzureClients = {
  blobContainer: string;
  blobContainerClient: ReturnType<BlobServiceClient["getContainerClient"]>;
  itemsTableClient: TableClient;
  authTableClient: TableClient;
  sharedKeyCredential: StorageSharedKeyCredential;
};

const getConnectionPart = (connectionString: string, key: string): string | null => {
  const pairs = connectionString.split(";");
  for (const pair of pairs) {
    const [k, ...rest] = pair.split("=");
    if (k === key) {
      return rest.join("=");
    }
  }

  return null;
};

let cachedClients: AzureClients | null = null;
let initializationPromise: Promise<void> | null = null;

const getClients = (): AzureClients => {
  if (cachedClients) {
    return cachedClients;
  }

  const env = getEnv();
  const connectionString = env.azureStorageConnectionString;
  const accountName = getConnectionPart(connectionString, "AccountName");
  const accountKey = getConnectionPart(connectionString, "AccountKey");

  if (!accountName || !accountKey) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING must include AccountName and AccountKey");
  }

  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

  cachedClients = {
    blobContainer: env.blobContainer,
    blobContainerClient: blobServiceClient.getContainerClient(env.blobContainer),
    itemsTableClient: TableClient.fromConnectionString(connectionString, env.itemsTable),
    authTableClient: TableClient.fromConnectionString(connectionString, env.authTable),
    sharedKeyCredential,
  };

  return cachedClients;
};

export const initializeStorage = async (): Promise<void> => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const clients = getClients();

      await Promise.all([
        clients.blobContainerClient.createIfNotExists(),
        clients.itemsTableClient.createTable().catch((error: { statusCode?: number }) => {
          if (error?.statusCode !== 409) {
            throw error;
          }
        }),
        clients.authTableClient.createTable().catch((error: { statusCode?: number }) => {
          if (error?.statusCode !== 409) {
            throw error;
          }
        }),
      ]);
    })();
  }

  await initializationPromise;
};

export const getBlobContainerClient = () => getClients().blobContainerClient;
export const getItemsTableClient = () => getClients().itemsTableClient;
export const getAuthTableClient = () => getClients().authTableClient;

export const createBlobReadSasUrl = (blobName: string, minutes = 20): string => {
  const clients = getClients();
  const startsOn = new Date(Date.now() - 2 * 60 * 1000);
  const expiresOn = new Date(Date.now() + minutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: clients.blobContainer,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    clients.sharedKeyCredential,
  ).toString();

  return `${clients.blobContainerClient.getBlobClient(blobName).url}?${sasToken}`;
};
