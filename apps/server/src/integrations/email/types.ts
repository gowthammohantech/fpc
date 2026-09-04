export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

/** Outbound mail — approval notifications and vendor payment confirmations. */
export interface Mailer {
  readonly name: string;
  send(mail: OutboundMail): Promise<{ messageId: string }>;
}

export interface InboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size?: number;
  /** Provider attachment id, so a retry need not re-list the message. */
  attachmentId?: string;
  /**
   * True for embedded images such as a signature logo. These make
   * `hasAttachments` true without there being anything to read, so they are
   * always filtered out.
   */
  isInline?: boolean;
}

export interface InboundMessage {
  /** Provider message id, used to avoid ingesting the same email twice. */
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: Date;
  bodyPreview?: string;
  attachments: InboundAttachment[];
  /** RFC 5322 Message-ID — identical across every copy of the same email. */
  internetMessageId?: string;
  conversationId?: string;
  /** Deep link that opens the message in the provider's own client. */
  webLink?: string;
}

/**
 * Inbound invoice mailbox (PRD §11).
 *
 * The Graph driver polls a real Outlook mailbox; the fixture driver reads a
 * directory on disk, which is how the demo delivers `INV-9821.pdf` without any
 * mail infrastructure.
 */
export interface MailFetcher {
  readonly name: string;
  fetchUnread(mailbox: string, limit?: number): Promise<InboundMessage[]>;
  markProcessed(mailbox: string, messageId: string): Promise<void>;
}

/**
 * What a delegated sync wants out of a mailbox.
 *
 * `since` is the watermark and is never optional in practice: it is what stops
 * a sync re-reading the whole mailbox every time.
 */
export interface DelegatedMailQuery {
  folder: string;
  since?: Date;
  senderAllowlist?: string[];
  subjectKeywords?: string[];
  limit: number;
}

export interface DelegatedMailPage {
  messages: InboundMessage[];
  /** What the watermark should advance to, before any safety overlap. */
  newestReceivedAt?: Date;
  /** The provider had more waiting than `limit` allowed. */
  hasMore: boolean;
}

/**
 * Reads a mailbox as the signed-in user.
 *
 * Deliberately separate from {@link MailFetcher} rather than an extension of
 * it. That interface is built for a shared invoice mailbox nobody reads by
 * hand: it selects on unread and marks messages read when done. Applied to
 * somebody's real personal inbox, both are wrong — so this interface has no
 * write method at all, and progress is tracked on our side instead.
 */
export interface DelegatedMailFetcher {
  readonly name: string;
  fetchMessages(accessToken: string, query: DelegatedMailQuery): Promise<DelegatedMailPage>;
}
