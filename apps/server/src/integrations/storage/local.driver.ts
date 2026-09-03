import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { BlobPayload, BlobStorage, StoredBlob } from './types.js';

/** Filesystem-backed blob storage. The default in development and demos. */
export class LocalDiskStorage implements BlobStorage {
  readonly name = 'local';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async put(payload: BlobPayload): Promise<StoredBlob> {
    const target = this.resolveKey(payload.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, payload.body);
    return {
      key: payload.key,
      size: payload.body.byteLength,
      contentType: payload.contentType,
      checksum: createHash('sha256').update(payload.body).digest('hex'),
    };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async stream(key: string): Promise<Readable> {
    const target = this.resolveKey(key);
    await stat(target);
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async signedUrl(): Promise<string | null> {
    // Local files are served through the API's own download route instead.
    return null;
  }

  /** Rejects any key that would escape the storage root. */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, normalize(key)));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Refusing to access blob outside the storage root: ${key}`);
    }
    return target;
  }
}
