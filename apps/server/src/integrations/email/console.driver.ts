import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import type { Mailer, OutboundMail } from './types.js';

/** Logs mail instead of sending it. Used in tests and offline demos. */
export class ConsoleMailer implements Mailer {
  readonly name = 'console';
  /** Retained so tests can assert on what would have been sent. */
  readonly sent: OutboundMail[] = [];

  async send(mail: OutboundMail): Promise<{ messageId: string }> {
    this.sent.push(mail);
    logger.info({ to: mail.to, subject: mail.subject }, 'outbound email (console driver)');
    return { messageId: `console-${randomUUID()}` };
  }
}
