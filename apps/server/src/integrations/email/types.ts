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
