import { InvoiceStatus } from '@fpc/shared';
import { logger } from '../config/logger.js';
import { Invoice } from '../models/invoice.model.js';
import * as invoiceService from '../modules/invoices/invoice.service.js';

const BATCH_SIZE = 10;
/** How long an EXTRACTING invoice may sit before we assume the worker died. */
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Picks up invoices awaiting extraction.
 *
 * Uploads and email intake both kick off extraction inline; this sweep is the
 * safety net that recovers anything interrupted by a restart, and retries
 * transient extraction failures.
 */
export async function processPendingExtractions(): Promise<{ processed: number }> {
  const stuckSince = new Date(Date.now() - STUCK_AFTER_MS);

  const pending = await Invoice.find({
    $or: [
      { status: InvoiceStatus.RECEIVED },
      { status: InvoiceStatus.FAILED, extractionAttempts: { $lt: 3 } },
      { status: InvoiceStatus.EXTRACTING, updatedAt: { $lt: stuckSince } },
    ],
  })
    .select('_id status')
    .limit(BATCH_SIZE)
    .lean();

  for (const invoice of pending) {
    // A stuck EXTRACTING record is returned to RECEIVED so the normal path
    // can pick it up again.
    if (invoice.status === InvoiceStatus.EXTRACTING) {
      await Invoice.updateOne({ _id: invoice._id }, { status: InvoiceStatus.RECEIVED });
    }
    await invoiceService.runExtraction(invoice._id);
  }

  if (pending.length) logger.debug({ processed: pending.length }, 'extraction sweep complete');
  return { processed: pending.length };
}
