import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import type { BlobPayload, BlobStorage, StoredBlob } from './types.js';

/** Azure Blob Storage driver — the production target for invoice documents. */
export class AzureBlobStorage implements BlobStorage {
  readonly name = 'azure';
  private readonly service: BlobServiceClient;
  private readonly containerName: string;
  private containerReady: Promise<void> | null = null;

  constructor(connectionString: string, containerName: string) {
    this.service = BlobServiceClient.fromConnectionString(connectionString);
    this.containerName = containerName;
  }

  async put(payload: BlobPayload): Promise<StoredBlob> {
    const client = (await this.container()).getBlockBlobClient(payload.key);
    await client.uploadData(payload.body, {
      blobHTTPHeaders: { blobContentType: payload.contentType },
    });
    return {
      key: payload.key,
      size: payload.body.byteLength,
      contentType: payload.contentType,
      checksum: createHash('sha256').update(payload.body).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    const client = (await this.container()).getBlockBlobClient(key);
    return client.downloadToBuffer();
  }

  async stream(key: string): Promise<Readable> {
    const client = (await this.container()).getBlockBlobClient(key);
    const response = await client.download();
    if (!response.readableStreamBody) throw new Error(`Blob has no content: ${key}`);
    return response.readableStreamBody as Readable;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.container()).getBlockBlobClient(key).exists();
  }

  async delete(key: string): Promise<void> {
    await (await this.container()).getBlockBlobClient(key).deleteIfExists();
  }

  /** Short-lived read SAS so a browser can fetch the document directly. */
  async signedUrl(key: string, expiresInSeconds = 600): Promise<string | null> {
    const credential = this.service.credential;
    if (!(credential instanceof StorageSharedKeyCredential)) return null;

    const client = (await this.container()).getBlockBlobClient(key);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(Date.now() - 60_000),
        expiresOn: new Date(Date.now() + expiresInSeconds * 1000),
      },
      credential,
    ).toString();

    return `${client.url}?${sas}`;
  }

  private async container() {
    const client = this.service.getContainerClient(this.containerName);
    this.containerReady ??= client.createIfNotExists().then(() => undefined);
    await this.containerReady;
    return client;
  }
}
