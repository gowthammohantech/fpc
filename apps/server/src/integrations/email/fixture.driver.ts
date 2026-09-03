import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { logger } from '../../config/logger.js';
import type { InboundMessage, MailFetcher } from './types.js';

const SUPPORTED = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

/**
 * Reads "email" from a directory on disk.
 *
 * Dropping `INV-9821.pdf` into `fixtures/inbox/` is exactly equivalent, from
 * the platform's point of view, to a vendor emailing it — which is what makes
 * the flagship demo runnable without any mail infrastructure. Sender and
 * subject can be supplied by an optional `<file>.meta.json` sidecar.
 */
export class FixtureMailFetcher implements MailFetcher {
  readonly name = 'fixture';
  private readonly inbox: string;
  private readonly processed: string;

  constructor(directory: string) {
    this.inbox = resolve(directory);
    this.processed = join(this.inbox, 'processed');
  }

  async fetchUnread(_mailbox: string, limit = 25): Promise<InboundMessage[]> {
    let entries: string[];
    try {
      entries = await readdir(this.inbox);
    } catch {
      logger.debug({ inbox: this.inbox }, 'fixture inbox does not exist yet');
      return [];
    }

    const messages: InboundMessage[] = [];
    for (const entry of entries) {
      if (messages.length >= limit) break;
      if (!SUPPORTED.has(extname(entry).toLowerCase())) continue;

      const path = join(this.inbox, entry);
      const info = await stat(path);
      if (!info.isFile()) continue;

      const content = await readFile(path);
      const meta = await this.readSidecar(path);

      messages.push({
        messageId: createHash('sha1').update(`${entry}:${info.size}:${info.mtimeMs}`).digest('hex'),
        from: meta.from ?? 'accounts@vendor.example.com',
        to: meta.to ?? [_mailbox],
        subject: meta.subject ?? `Invoice ${basename(entry, extname(entry))}`,
        receivedAt: info.mtime,
        attachments: [{ filename: entry, contentType: contentTypeFor(entry), content }],
      });
    }
    return messages;
  }

  /** Moves the file into `processed/` so the poller does not re-ingest it. */
  async markProcessed(_mailbox: string, messageId: string): Promise<void> {
    const entries = await readdir(this.inbox).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!SUPPORTED.has(extname(entry).toLowerCase())) continue;
      const path = join(this.inbox, entry);
      const info = await stat(path);
      const id = createHash('sha1').update(`${entry}:${info.size}:${info.mtimeMs}`).digest('hex');
      if (id !== messageId) continue;

      await mkdir(this.processed, { recursive: true });
      await rename(path, join(this.processed, entry));
      await rename(`${path}.meta.json`, join(this.processed, `${entry}.meta.json`)).catch(() => {});
      return;
    }
  }

  private async readSidecar(
    path: string,
  ): Promise<{ from?: string; to?: string[]; subject?: string }> {
    try {
      return JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as {
        from?: string;
        to?: string[];
        subject?: string;
      };
    } catch {
      return {};
    }
  }
}

export function contentTypeFor(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.csv':
      return 'text/csv';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    default:
      return 'application/octet-stream';
  }
}
