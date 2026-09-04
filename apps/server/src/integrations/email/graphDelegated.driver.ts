import { Client } from '@microsoft/microsoft-graph-client';
import type {
  DelegatedMailFetcher,
  DelegatedMailPage,
  DelegatedMailQuery,
  InboundAttachment,
  InboundMessage,
} from './types.js';

/**
 * Reads a user's own Outlook mailbox through Microsoft Graph.
 *
 * The app-only `GraphMailFetcher` next door authenticates as the application
 * against `/users/{mailbox}`; this authenticates as the person against `/me`
 * with a token the connector already resolved. It never writes: the shared
 * mailbox driver marks messages read, which would quietly destroy a real
 * person's unread triage, so progress is tracked as a watermark on our side.
 */

/** Graph caps `$top` at 999, but small pages keep any one request cheap. */
const PAGE_SIZE = 50;

/** Bounds one sync so a huge mailbox cannot run forever. */
const MAX_PAGES = 5;

/** Headroom under the 25 MB cap the upload endpoint already enforces. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Beyond this the OR-chain makes the URL long and the query plan fragile. */
const MAX_INLINE_SENDERS = 5;

/**
 * Builds the `$filter` half of the message query.
 *
 * What is *not* here matters as much as what is. Subject keywords are absent on
 * purpose: Graph `$filter` has no `contains()` on `subject`, and the `$search`
 * alternative cannot be combined with `$filter` or `$orderby` — and the
 * watermark clause is the one we cannot afford to lose. So subjects are matched
 * in JavaScript after the fetch. Domain-form senders (`@vendor.com`) are absent
 * for the same reason: no `endswith` in a combined filter.
 *
 * Exported for tests, which is the only way to assert on a URL we never send.
 */
export function buildMessageFilter(query: DelegatedMailQuery): string {
  const clauses = ['hasAttachments eq true'];

  // Never optional: without the watermark every sync re-reads the mailbox.
  if (query.since) clauses.push(`receivedDateTime ge ${query.since.toISOString()}`);

  const exact = (query.senderAllowlist ?? []).filter((entry) => !entry.startsWith('@'));
  const hasDomainForm = (query.senderAllowlist ?? []).some((entry) => entry.startsWith('@'));
  if (exact.length && exact.length <= MAX_INLINE_SENDERS && !hasDomainForm) {
    const ors = exact
      .map((address) => `from/emailAddress/address eq '${address.replace(/'/g, "''")}'`)
      .join(' or ');
    clauses.push(`(${ors})`);
  }

  return clauses.join(' and ');
}

const SELECT_FIELDS = [
  'id',
  'internetMessageId',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'receivedDateTime',
  'bodyPreview',
  'hasAttachments',
  'webLink',
].join(',');

export class DelegatedGraphMailFetcher implements DelegatedMailFetcher {
  readonly name = 'graph-delegated';

  async fetchMessages(accessToken: string, query: DelegatedMailQuery): Promise<DelegatedMailPage> {
    const client = clientFor(accessToken);
    const folder = encodeURIComponent(query.folder || 'inbox');

    const raw: GraphMessage[] = [];
    let hasMore = false;
    let request = client
      .api(`/me/mailFolders/${folder}/messages`)
      .filter(buildMessageFilter(query))
      // Ascending, and this is load-bearing. With a per-sync cap, newest-first
      // would process recent mail and then advance the watermark past
      // everything older, stranding those messages forever. Oldest-first means
      // the watermark only ever moves to a message we actually handled.
      .orderby('receivedDateTime asc')
      .top(Math.min(query.limit, PAGE_SIZE))
      .select(SELECT_FIELDS);

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = (await request.get()) as GraphList<GraphMessage>;
      raw.push(...(response.value ?? []));

      const next = response['@odata.nextLink'];
      if (raw.length >= query.limit) {
        hasMore = raw.length > query.limit || Boolean(next);
        break;
      }
      if (!next) break;
      request = client.api(next);
      if (page === MAX_PAGES - 1) hasMore = true;
    }

    const messages: InboundMessage[] = [];
    for (const message of raw.slice(0, query.limit)) {
      messages.push({
        messageId: message.id,
        internetMessageId: message.internetMessageId,
        conversationId: message.conversationId,
        from: message.from?.emailAddress?.address?.toLowerCase() ?? '',
        to: (message.toRecipients ?? []).map((r) => r.emailAddress.address.toLowerCase()),
        subject: message.subject ?? '(no subject)',
        receivedAt: new Date(message.receivedDateTime),
        bodyPreview: message.bodyPreview,
        webLink: message.webLink,
        attachments: await this.attachmentsFor(client, message.id),
      });
    }

    const newest = messages.reduce<Date | undefined>(
      (latest, message) => (!latest || message.receivedAt > latest ? message.receivedAt : latest),
      undefined,
    );

    return { messages, newestReceivedAt: newest, hasMore };
  }

  /**
   * Lists attachment metadata first and downloads only what we can read.
   *
   * Fetching bodies up front would pull a 20 MB video across the wire just to
   * discover it is not a PDF.
   */
  private async attachmentsFor(client: Client, messageId: string): Promise<InboundAttachment[]> {
    const listed = (await client
      .api(`/me/messages/${messageId}/attachments`)
      .select('id,name,contentType,size,isInline')
      .get()) as GraphList<GraphAttachment>;

    const attachments: InboundAttachment[] = [];
    for (const item of listed.value ?? []) {
      const inline = item.isInline === true;
      const oversize = (item.size ?? 0) > MAX_ATTACHMENT_BYTES;

      // The caller decides what to do about inline and oversize entries; it
      // still needs to see them so the screen can explain the skip file by file.
      if (inline || oversize) {
        attachments.push({
          filename: item.name,
          contentType: item.contentType,
          content: Buffer.alloc(0),
          size: item.size ?? 0,
          attachmentId: item.id,
          isInline: inline,
        });
        continue;
      }

      const full = (await client
        .api(`/me/messages/${messageId}/attachments/${item.id}`)
        .get()) as GraphAttachment;
      if (full['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;

      attachments.push({
        filename: item.name,
        contentType: item.contentType,
        content: Buffer.from(full.contentBytes ?? '', 'base64'),
        size: item.size ?? 0,
        attachmentId: item.id,
        isInline: false,
      });
    }
    return attachments;
  }
}

function clientFor(accessToken: string): Client {
  // The token is already resolved and refreshed by the connector, so the auth
  // provider has nothing to do but hand it over.
  return Client.init({ authProvider: (done) => done(null, accessToken) });
}

interface GraphList<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
}

interface GraphAttachment {
  '@odata.type'?: string;
  id: string;
  name: string;
  contentType: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
}
