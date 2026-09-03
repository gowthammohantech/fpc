import type { Readable } from 'node:stream';

export interface StoredBlob {
  key: string;
  size: number;
  contentType: string;
  checksum: string;
}

export interface BlobPayload {
  /** Path within the container, e.g. `invoices/<id>/INV-9821.pdf`. */
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * Blob storage abstraction.
 *
 * The Azure driver is the production target; the local-disk driver keeps the
 * whole product runnable with no cloud credentials, which is what the demo
 * environment uses.
 */
export interface BlobStorage {
  readonly name: string;
  put(payload: BlobPayload): Promise<StoredBlob>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Time-limited direct URL when the driver supports one, else null. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}
