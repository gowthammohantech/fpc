import { Types } from 'mongoose';
import {
  InvoiceStatus,
  ValidationCode,
  invoiceMachine,
  normalizeName,
  parseAmountToMinor,
  type ExtractionResult,
  type ValidationFinding,
} from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../core/errors.js';
import { contentTypeFor } from '../../integrations/email/index.js';
import { extractor } from '../../integrations/ocr/index.js';
import { storage } from '../../integrations/storage/index.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { Invoice, type InvoiceDoc } from '../../models/invoice.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { blockingFindings, validateInvoice } from './invoice.validation.js';

export interface IntakeInput {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  fileName: string;
  contentType: string;
  content: Buffer;
  source: 'EMAIL' | 'UPLOAD';
  uploadedBy?: Types.ObjectId;
  emailMessageId?: string;
  senderEmail?: string;
}

const MAX_EXTRACTION_ATTEMPTS = 3;

/**
 * Creates an invoice from an uploaded file or an inbound email attachment
 * (PRD §11). The document is stored first, so the record always has something
 * a reviewer can open, then extraction is left to the background worker.
 */
export async function intake(input: IntakeInput, context: AuditContext): Promise<InvoiceDoc & { _id: Types.ObjectId }> {
  if (input.emailMessageId) {
    const existing = await Invoice.findOne({
      tenantId: input.tenantId,
      emailMessageId: input.emailMessageId,
    }).lean();
    if (existing) {
      logger.debug({ messageId: input.emailMessageId }, 'email already ingested; skipping');
      return existing as InvoiceDoc & { _id: Types.ObjectId };
    }
  }

  const invoice = await Invoice.create({
    tenantId: input.tenantId,
    companyId: input.companyId,
    currency: 'INR',
    status: InvoiceStatus.RECEIVED,
    source: input.source,
    documentFileName: input.fileName,
    receivedAt: new Date(),
    emailMessageId: input.emailMessageId,
    senderEmail: input.senderEmail,
    findings: [],
    lines: [],
  });

  const key = `invoices/${String(invoice._id)}/${sanitizeFileName(input.fileName)}`;
  const stored = await storage().put({
    key,
    body: input.content,
    contentType: input.contentType || contentTypeFor(input.fileName),
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
    kind: 'INVOICE',
  });

  invoice.documentFileId = file._id;
  await invoice.save();

  await audit.record(
    {
      event: 'invoice.received',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: input.fileName,
      tenantId: input.tenantId,
      companyId: input.companyId,
      metadata: { source: input.source, fileName: input.fileName, senderEmail: input.senderEmail },
    },
    context,
  );

  return invoice.toObject() as InvoiceDoc & { _id: Types.ObjectId };
}

/**
 * Runs extraction for one invoice and moves it to REVIEW_REQUIRED (PRD §12).
 *
 * Called by the background worker. Extraction failures are recorded on the
 * invoice and retried a bounded number of times before the invoice is parked
 * in FAILED, where a reviewer can still open the document and key it manually.
 */
export async function runExtraction(invoiceId: Types.ObjectId): Promise<void> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return;
  if (invoice.status !== InvoiceStatus.RECEIVED && invoice.status !== InvoiceStatus.FAILED) return;

  await transition(invoice, InvoiceStatus.EXTRACTING);
  invoice.extractionAttempts += 1;
  await invoice.save();

  try {
    const file = invoice.documentFileId ? await DocumentFile.findById(invoice.documentFileId) : null;
    if (!file) throw new Error('Invoice document is missing');

    const vendors = await Vendor.find({
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      status: 'ACTIVE',
    })
      .select('name')
      .limit(500)
      .lean();

    const result = await extractor().extract({
      fileName: file.fileName,
      contentType: file.contentType,
      content: await storage().get(file.key),
      knownVendorNames: vendors.map((vendor) => vendor.name),
    });

    await applyExtraction(invoice, result);
    invoice.extractionError = undefined;
    await transition(invoice, InvoiceStatus.REVIEW_REQUIRED);
    await invoice.save();

    await audit.record({
      event: 'invoice.extracted',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber ?? invoice.documentFileName,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      metadata: {
        provider: result.provider,
        model: result.model,
        overallConfidence: result.overallConfidence,
        fields: Object.keys(result.fields),
      },
    });
  } catch (error) {
    logger.error({ err: error, invoiceId: String(invoiceId) }, 'invoice extraction failed');
    invoice.extractionError = (error as Error).message;

    // Give up on automated extraction, but keep the invoice reviewable rather
    // than losing it: a human can still key the fields from the document.
    const target =
      invoice.extractionAttempts >= MAX_EXTRACTION_ATTEMPTS
        ? InvoiceStatus.REVIEW_REQUIRED
        : InvoiceStatus.FAILED;
    await transition(invoice, target);
    await invoice.save();
  }
}

/** Maps an extraction result onto the invoice's own fields. */
async function applyExtraction(
  invoice: InvoiceDoc & { _id: Types.ObjectId; save: () => Promise<unknown> },
  result: ExtractionResult,
): Promise<void> {
  invoice.extraction = result;
  const fields = result.fields;

  const text = (key: string): string | undefined => {
    const value = fields[key]?.value;
    return value === null || value === undefined ? undefined : String(value);
  };
  const amount = (key: string): number | undefined => {
    const value = fields[key]?.value;
    return value === null || value === undefined ? undefined : (parseAmountToMinor(value) ?? undefined);
  };
  const date = (key: string): Date | undefined => {
    const raw = text(key);
    if (!raw) return undefined;
    const parsed = parseInvoiceDate(raw);
    return parsed ?? undefined;
  };

  invoice.invoiceNumber = text('invoiceNumber') ?? invoice.invoiceNumber;
  invoice.vendorName = text('vendorName') ?? invoice.vendorName;
  invoice.invoiceDate = date('invoiceDate') ?? invoice.invoiceDate;
  invoice.dueDate = date('dueDate') ?? invoice.dueDate;
  invoice.gstin = text('gstin') ?? invoice.gstin;
  invoice.subtotal = amount('subtotal') ?? invoice.subtotal;
  invoice.taxAmount = amount('taxAmount') ?? invoice.taxAmount;
  invoice.totalAmount = amount('totalAmount') ?? invoice.totalAmount;

  if (result.lineItems.length) {
    invoice.lines = result.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice !== undefined ? (parseAmountToMinor(item.unitPrice) ?? undefined) : undefined,
      amount: parseAmountToMinor(item.amount ?? 0) ?? 0,
      hsnSac: item.hsnSac,
      taxRate: item.taxRate,
    }));
  }

  // Resolve the extracted vendor name against the master so payment details
  // come from our own record, never from the document.
  if (!invoice.vendorId && invoice.vendorName) {
    const vendor = await Vendor.findOne({
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      nameNormalized: normalizeName(invoice.vendorName),
    }).lean();
    if (vendor) {
      invoice.vendorId = vendor._id;
      invoice.vendorName = vendor.name;
      if (!invoice.dueDate && invoice.invoiceDate) {
        const due = new Date(invoice.invoiceDate);
        due.setDate(due.getDate() + (vendor.paymentTermsDays ?? 30));
        invoice.dueDate = due;
      }
    }
  }

  invoice.findings = await validateInvoice({
    tenantId: invoice.tenantId,
    companyId: invoice.companyId,
    invoice,
    excludeInvoiceId: invoice._id,
  });
}

/** Re-runs validation after a reviewer edits fields. */
export async function revalidate(
  invoice: InvoiceDoc & { _id: Types.ObjectId },
): Promise<ValidationFinding[]> {
  const fresh = await validateInvoice({
    tenantId: invoice.tenantId,
    companyId: invoice.companyId,
    invoice,
    excludeInvoiceId: invoice._id,
  });

  // Resolutions a reviewer has already recorded survive re-validation, so an
  // acknowledged duplicate warning does not reappear on every save.
  const resolved = new Map(
    invoice.findings.filter((finding) => finding.resolved).map((finding) => [finding.code, finding]),
  );
  return fresh.map((finding) => {
    const previous = resolved.get(finding.code);
    return previous ? { ...finding, ...pickResolution(previous) } : finding;
  });
}

function pickResolution(finding: ValidationFinding) {
  return {
    resolved: finding.resolved,
    resolvedBy: finding.resolvedBy,
    resolvedAt: finding.resolvedAt,
    resolutionNote: finding.resolutionNote,
  };
}

/** Asserts the transition is legal, then applies it. */
export async function transition(
  invoice: { status: InvoiceStatus },
  to: InvoiceStatus,
): Promise<InvoiceStatus> {
  const from = invoice.status;
  invoiceMachine.assertTransition(from, to);
  invoice.status = to;
  return from;
}

export function assertSubmittable(invoice: InvoiceDoc): void {
  const blocking = blockingFindings(invoice.findings);
  if (blocking.length) {
    throw ApiError.unprocessable(
      'This invoice has unresolved validation findings and cannot be submitted',
      blocking.map((finding) => ({ code: finding.code, message: finding.message })),
    );
  }
  if (!invoice.vendorId) {
    throw ApiError.unprocessable('Assign a vendor from the vendor master before submitting');
  }
  if (!invoice.totalAmount || invoice.totalAmount <= 0) {
    throw ApiError.unprocessable('A positive total amount is required before submitting');
  }
}

export const DUPLICATE_CODES: string[] = [
  ValidationCode.EXACT_DUPLICATE,
  ValidationCode.POSSIBLE_DUPLICATE,
];

/**
 * Parses the date formats that actually appear on Indian invoices:
 * 05-Sep-2026, 05/09/2026 (day first), and ISO.
 */
export function parseInvoiceDate(raw: string): Date | null {
  const value = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const named = /^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/.exec(value);
  if (named) {
    const month = MONTHS.indexOf(named[2]!.slice(0, 3).toLowerCase());
    if (month >= 0) return utc(fullYear(Number(named[3])), month, Number(named[1]));
  }

  // Ambiguous numeric form: Indian invoices are day-first.
  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(value);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (day <= 31 && month <= 12) return utc(fullYear(Number(numeric[3])), month - 1, day);
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
}
