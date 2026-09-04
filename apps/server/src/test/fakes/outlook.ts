import type {
  DelegatedMailFetcher,
  DelegatedMailPage,
  DelegatedMailQuery,
  InboundAttachment,
  InboundMessage,
} from '../../integrations/email/types.js';
import type {
  OutlookAccount,
  OutlookOAuthClient,
  OutlookTokenResponse,
} from '../../modules/integrations/outlook/oauth.client.js';

/**
 * Stand-ins for Microsoft, installed through the same seams the production
 * drivers use. Nothing here patches a global, so a test never has to reason
 * about what else in the process might be using `fetch`.
 */

export const FAKE_REFRESH_TOKEN = 'fake-refresh-token-0001';
export const FAKE_ACCESS_TOKEN = 'fake-access-token-0001';

export class FakeOutlookOAuth implements OutlookOAuthClient {
  readonly name = 'fake';
  /** Every state token handed out, so a test can replay the real callback. */
  readonly issuedStates: string[] = [];

  constructor(private readonly account: OutlookAccount) {}

  authorizeUrl(state: string): string {
    this.issuedStates.push(state);
    const params = new URLSearchParams({
      client_id: 'fake-client',
      response_type: 'code',
      scope: 'offline_access Mail.Read User.Read',
      state,
    });
    return `https://login.microsoftonline.test/common/oauth2/v2.0/authorize?${params}`;
  }

  async exchangeCode(): Promise<OutlookTokenResponse> {
    return this.issue();
  }

  async refresh(): Promise<OutlookTokenResponse> {
    return this.issue();
  }

  async me(): Promise<OutlookAccount> {
    return this.account;
  }

  private issue(): OutlookTokenResponse {
    return {
      accessToken: FAKE_ACCESS_TOKEN,
      refreshToken: FAKE_REFRESH_TOKEN,
      expiresInSeconds: 3600,
      scopes: ['offline_access', 'Mail.Read', 'User.Read'],
    };
  }
}

/**
 * Returns a canned inbox.
 *
 * Deliberately dumb: it applies no rules of its own, so a test can prove that
 * the filtering the screen reports is the connector's own work rather than
 * something the provider did for us.
 */
export class FakeDelegatedMailFetcher implements DelegatedMailFetcher {
  readonly name = 'fake-delegated';
  /** Every query it was asked, so a test can assert on the watermark. */
  readonly queries: DelegatedMailQuery[] = [];

  constructor(public messages: InboundMessage[] = []) {}

  async fetchMessages(_accessToken: string, query: DelegatedMailQuery): Promise<DelegatedMailPage> {
    this.queries.push(query);
    const messages = this.messages.slice(0, query.limit);
    const newest = messages.reduce<Date | undefined>(
      (latest, message) => (!latest || message.receivedAt > latest ? message.receivedAt : latest),
      undefined,
    );
    return {
      messages,
      ...(newest ? { newestReceivedAt: newest } : {}),
      hasMore: this.messages.length > query.limit,
    };
  }
}

/** A minimal but genuinely parseable PDF, so extraction has something to read. */
export function fakePdf(text = 'INVOICE'): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, 'utf8');
}

export function fakeAttachment(overrides: Partial<InboundAttachment> = {}): InboundAttachment {
  const content = overrides.content ?? fakePdf();
  return {
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    content,
    size: content.length,
    attachmentId: 'att-1',
    ...overrides,
  };
}

export function fakeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'AAM=fake-1',
    internetMessageId: '<fake-1@vendor.com>',
    from: 'ap@vendor.com',
    to: ['finance@nova.example.com'],
    subject: 'Invoice INV-7001 for August',
    receivedAt: new Date('2026-09-01T10:00:00.000Z'),
    webLink: 'https://outlook.office.com/mail/id/AAM=fake-1',
    attachments: [fakeAttachment()],
    ...overrides,
  };
}
