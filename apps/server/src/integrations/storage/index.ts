import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AzureBlobStorage } from './azure.driver.js';
import { LocalDiskStorage } from './local.driver.js';
import type { BlobStorage } from './types.js';

export * from './types.js';

let instance: BlobStorage | null = null;

/** The configured blob storage driver (STORAGE_DRIVER). */
export function storage(): BlobStorage {
  if (instance) return instance;

  if (env.STORAGE_DRIVER === 'azure') {
    if (!env.AZURE_STORAGE_CONNECTION_STRING) {
      throw new Error('STORAGE_DRIVER=azure requires AZURE_STORAGE_CONNECTION_STRING');
    }
    instance = new AzureBlobStorage(
      env.AZURE_STORAGE_CONNECTION_STRING,
      env.AZURE_STORAGE_CONTAINER,
    );
  } else {
    instance = new LocalDiskStorage(env.STORAGE_LOCAL_DIR);
  }

  logger.info({ driver: instance.name }, 'blob storage driver ready');
  return instance;
}

/** Test seam: replace the driver. */
export function setStorage(driver: BlobStorage | null): void {
  instance = driver;
}
