import { Types } from 'mongoose';
import { SUPPORTED_INVOICE_CONTENT_TYPES } from '@fpc/shared';
import { logger } from '../config/logger.js';
import { mailFetcher } from '../integrations/email/index.js';
import { Company } from '../models/company.model.js';
import { Invoice } from '../models/invoice.model.js';
import * as invoiceService from '../modules/invoices/invoice.service.js';

const SUPPORTED = new Set<string>(SUPPORTED_INVOICE_CONTENT_TYPES);

/**
 * Polls each company's configured invoice mailbox and creates invoices from
 * the attachments (PRD §11).
 *
 * The PRD's target is email → system record in under a minute, which the
 * default one-minute poll interval meets.
 */
export async function pollInvoiceMailboxes(): Promise<{ ingested: number }> {
  const companies = await Company.find({
    active: true,
    invoiceInboxAddress: { $exists: true, $ne: null },
  }).lean();

  let ingested = 0;
  for (const company of companies) {
    const mailbox = company.invoiceInboxAddress;
    if (!mailbox) continue;

    try {
      const messages = await mailFetcher().fetchUnread(mailbox);
      for (const message of messages) {
        const attachments = message.attachments.filter((file) => SUPPORTED.has(file.contentType));

        if (!attachments.length) {
          // Nothing we can process — mark it read so we do not re-poll forever.
          await mailFetcher().markProcessed(mailbox, message.messageId);
          continue;
        }

        for (const [index, attachment] of attachments.entries()) {
          // One message can carry several invoices; each becomes its own
          // record with a distinct ingestion key.
          const messageKey =
            attachments.length > 1 ? `${message.messageId}#${index}` : message.messageId;

          const alreadySeen = await Invoice.exists({
            tenantId: company.tenantId,
            emailMessageId: messageKey,
          });
          if (alreadySeen) continue;

          const invoice = await invoiceService.intake(
            {
              tenantId: company.tenantId as Types.ObjectId,
              companyId: company._id,
              fileName: attachment.filename,
              contentType: attachment.contentType,
              content: attachment.content,
              source: 'EMAIL',
              emailMessageId: messageKey,
              senderEmail: message.from,
            },
            {},
          );

          void invoiceService.runExtraction(invoice._id);
          ingested += 1;
        }

        await mailFetcher().markProcessed(mailbox, message.messageId);
      }
    } catch (error) {
      logger.error({ err: error, company: company.name }, 'invoice mailbox poll failed');
    }
  }

  if (ingested) logger.info({ ingested }, 'invoices ingested from email');
  return { ingested };
}
