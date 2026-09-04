import { Types, type HydratedDocument } from 'mongoose';
import { fromMinor } from '@fpc/shared';
import { storage } from '../integrations/storage/index.js';
import { DocumentFile } from '../models/documentFile.model.js';
import type { InvoiceDoc } from '../models/invoice.model.js';
import { buildPdf } from './fixtures.js';

/**
 * Real blobs for seeded records.
 *
 * Mirrors what `invoice.service.ts` does on intake — same key shape, same
 * `DocumentFile` fields — so a seeded invoice is indistinguishable from an
 * ingested one and the review screen's document pane has something to render.
 * Without this the invoices carried a file *name* and no file.
 */
export interface StoreResult {
  fileId: Types.ObjectId;
  fileName: string;
}

export async function storeDocument(input: {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  key: string;
  fileName: string;
  body: Buffer;
  contentType: string;
  uploadedBy?: Types.ObjectId;
  kind: 'INVOICE' | 'PAYROLL_IMPORT' | 'BANK_STATEMENT' | 'BANK_FILE' | 'OTHER';
}): Promise<StoreResult> {
  const stored = await storage().put({
    key: input.key,
    body: input.body,
    contentType: input.contentType,
  });

  const file = await DocumentFile.create({
    tenantId: input.tenantId,
    companyId: input.companyId,
    key: stored.key,
    fileName: input.fileName,
    contentType: stored.contentType,
    size: stored.size,
    checksum: stored.checksum,
    driver: storage().name,
    uploadedBy: input.uploadedBy,
    kind: input.kind,
  });

  return { fileId: file._id, fileName: input.fileName };
}

/**
 * Renders a seeded invoice as a PDF with a real text layer and attaches it.
 *
 * The text is generated from the stored fields, so the document beside the
 * extraction panel says the same thing the panel does.
 */
export async function attachInvoiceDocument(
  invoice: HydratedDocument<InvoiceDoc>,
  input: {
    fileName: string;
    description?: string;
    gstin?: string;
    companyName: string;
    uploadedBy?: Types.ObjectId;
  },
): Promise<void> {
  const fileName = input.fileName;

  const lines = [
    invoice.vendorName ?? 'Unidentified supplier',
    input.gstin ? `GSTIN: ${input.gstin}` : '',
    'TAX INVOICE',
    invoice.invoiceNumber ? `Invoice Number: ${invoice.invoiceNumber}` : '',
    invoice.invoiceDate ? `Invoice Date: ${formatDate(invoice.invoiceDate)}` : '',
    invoice.dueDate ? `Due Date: ${formatDate(invoice.dueDate)}` : '',
    `Bill To: ${input.companyName}`,
    input.description ? `Description: ${input.description}` : '',
    invoice.subtotal !== undefined ? `Sub Total: ${fromMinor(invoice.subtotal).toFixed(2)}` : '',
    invoice.taxAmount !== undefined ? `Total Tax: ${fromMinor(invoice.taxAmount).toFixed(2)}` : '',
    invoice.totalAmount !== undefined
      ? `Grand Total: ${fromMinor(invoice.totalAmount).toFixed(2)}`
      : '',
  ].filter(Boolean);

  const stored = await storeDocument({
    tenantId: invoice.tenantId,
    companyId: invoice.companyId,
    key: `invoices/${String(invoice._id)}/${fileName}`,
    fileName,
    body: buildPdf(lines),
    contentType: 'application/pdf',
    uploadedBy: input.uploadedBy,
    kind: 'INVOICE',
  });

  invoice.documentFileId = stored.fileId;
  invoice.documentFileName = fileName;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `05-Sep-2026` — the form the extractor's date parser is written against. */
function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}
