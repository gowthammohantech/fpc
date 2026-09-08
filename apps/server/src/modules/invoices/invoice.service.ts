import { Types } from 'mongoose';
import {
  InvoiceStatus,
  NotificationType,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ValidationCode,
  computeTds,
  formatINR,
  invoiceMachine,
  netPayableFor,
  normalizeName,
  parseAmountToMinor,
  schemas,
  tdsBaseFor,
  type ExtractionResult,
  type Permission,
  type RoleKey,
  type TdsSection,
  type ValidationFinding,
} from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../core/errors.js';
import { eventBus } from '../../core/eventBus.js';
import { REFERENCE_PREFIX, nextReference } from '../../core/sequence.js';
import { contentTypeFor } from '../../integrations/email/index.js';
import { extractor } from '../../integrations/ocr/index.js';
import { storage } from '../../integrations/storage/index.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { Invoice, type InvoiceDoc } from '../../models/invoice.model.js';
import { Vendor, type VendorDoc } from '../../models/vendor.model.js';
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
 * Pre-fills the TDS figures from the vendor master.
 *
 * A proposal, not a decision: the accounting team confirms or overrides every
 * field before the invoice is cleared for payment. It is applied this early so
 * that approvers see the real cash figure rather than the gross bill.
 *
 * A vendor marked for TDS but with no PAN on file deducts nothing — withholding
 * against an unidentified payee is worse than not withholding at all, and the
 * accounting team is the right place to notice and fix it.
 */
export function proposeTds(
  invoice: Pick<
    InvoiceDoc,
    | 'subtotal'
    | 'taxAmount'
    | 'totalAmount'
    | 'tdsApplicable'
    | 'tdsSection'
    | 'tdsRateBasisPoints'
    | 'tdsBaseAmount'
    | 'tdsAmount'
  >,
  vendor: Pick<VendorDoc, 'pan' | 'tdsApplicable' | 'tdsSection' | 'tdsRateBasisPoints'>,
): void {
  const applicable = !!vendor.tdsApplicable && !!vendor.pan && !!vendor.tdsRateBasisPoints;
  invoice.tdsApplicable = applicable;
  invoice.tdsSection = applicable ? vendor.tdsSection : undefined;
  invoice.tdsRateBasisPoints = applicable ? vendor.tdsRateBasisPoints : undefined;

  const base = tdsBaseFor(invoice);
  invoice.tdsBaseAmount = applicable ? base : undefined;
  invoice.tdsAmount = computeTds({
    tdsApplicable: applicable,
    baseAmount: base,
    rateBasisPoints: vendor.tdsRateBasisPoints,
  });
}

/**
 * Creates an invoice from an uploaded file or an inbound email attachment
 * (PRD §11). The document is stored first, so the record always has something
 * a reviewer can open, then extraction is left to the background worker.
 */
export async function intake(
  input: IntakeInput,
  context: AuditContext,
): Promise<InvoiceDoc & { _id: Types.ObjectId }> {
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
    // Allocated up front so the invoice is quotable from the moment it lands,
    // including in the email that says it was received.
    trackingId: await nextReference(input.tenantId, REFERENCE_PREFIX.INVOICE),
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
    const file = invoice.documentFileId
      ? await DocumentFile.findById(invoice.documentFileId)
      : null;
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

    notifyIfDuplicate(invoice);

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
    return value === null || value === undefined
      ? undefined
      : (parseAmountToMinor(value) ?? undefined);
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
      unitPrice:
        item.unitPrice !== undefined
          ? (parseAmountToMinor(item.unitPrice) ?? undefined)
          : undefined,
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
      proposeTds(invoice, vendor);
    }
  }

  invoice.findings = await validateInvoice({
    tenantId: invoice.tenantId,
    companyId: invoice.companyId,
    invoice,
    excludeInvoiceId: invoice._id,
  });
}

/**
 * Raises the duplicate alert (PRD §34) when validation found one.
 *
 * Detection already blocks submission through the finding; this makes sure a
 * reviewer is actively told rather than discovering it on the invoice.
 */
function notifyIfDuplicate(invoice: InvoiceDoc & { _id: Types.ObjectId }): void {
  const duplicate = invoice.findings.find(
    (finding) => !finding.resolved && DUPLICATE_CODES.includes(finding.code),
  );
  if (!duplicate) return;

  eventBus.publish({
    type: NotificationType.INVOICE_DUPLICATE_DETECTED,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'INVOICE',
    entityId: String(invoice._id),
    recipientUserIds: [],
    recipientRoleKeys: DUPLICATE_ALERT_ROLES,
    title:
      `Possible duplicate: ${invoice.vendorName ?? 'invoice'} ${invoice.invoiceNumber ?? ''}`.trim(),
    body: duplicate.message,
    link: `/invoices/${String(invoice._id)}`,
  });
}

/**
 * Records what the accounting team keyed, and derives the TDS figures.
 *
 * The client never supplies `netPayable` — it is derived from the gross bill
 * and the deduction here and again in the model's pre-validate hook, so no
 * request can dictate what the bank pays.
 */
export function applyAccountingDecision(
  invoice: InvoiceDoc,
  body: schemas.VerifyInvoiceRequest,
  verifiedByUserId: Types.ObjectId,
): void {
  invoice.tdsApplicable = body.tdsApplicable;
  invoice.tdsSection = body.tdsApplicable ? (body.tdsSection as TdsSection) : undefined;
  invoice.tdsRateBasisPoints = body.tdsApplicable ? body.tdsRateBasisPoints : undefined;

  const base = body.tdsBaseAmount ?? tdsBaseFor(invoice);
  invoice.tdsBaseAmount = body.tdsApplicable ? base : undefined;

  const computed = computeTds({
    tdsApplicable: body.tdsApplicable,
    baseAmount: base,
    rateBasisPoints: body.tdsRateBasisPoints,
  });
  // An explicit amount overrides the computed one — rounding conventions and
  // part-period deductions are real — but it can never exceed the invoice.
  const keyed = body.tdsApplicable ? (body.tdsAmount ?? computed) : 0;
  invoice.tdsAmount = Math.min(keyed, invoice.totalAmount ?? 0);
  invoice.netPayable = netPayableFor(invoice.totalAmount ?? 0, invoice.tdsAmount);

  invoice.accounting = {
    verifiedByUserId,
    verifiedAt: new Date(),
    glCode: body.glCode,
    costCentre: body.costCentre,
    notes: body.notes,
  };
}

/**
 * Clears a verified invoice for payment and creates its obligation.
 *
 * The single release point into the payment pipeline: accounting reaches it
 * directly, and Treasury reaches it by approving an escalation. Nothing
 * else may put an invoice into APPROVED.
 */
export async function releaseToAccountsPayable(
  invoice: InvoiceDoc & { _id: Types.ObjectId; save(): Promise<unknown> },
  context: AuditContext,
): Promise<void> {
  const from = invoice.status;
  await transition(invoice, InvoiceStatus.APPROVED);
  await invoice.save();

  await audit.recordStatusChange(
    {
      event: 'invoice.cleared_for_payment',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.trackingId,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: InvoiceStatus.APPROVED,
      metadata: {
        grossAmount: invoice.totalAmount,
        tdsAmount: invoice.tdsAmount,
        netPayable: invoice.netPayable,
      },
    },
    context,
  );

  const { createObligationForInvoice } = await import('../payments/obligation.service.js');
  await createObligationForInvoice(invoice._id, context);
}

/**
 * Sends an invoice back to the department that raised it.
 *
 * The completed approval chain is cancelled with it — an invoice that has to
 * be corrected must be approved again on its corrected figures, not carry an
 * old sign-off forward.
 */
export async function returnToReview(
  invoice: InvoiceDoc & { _id: Types.ObjectId; save(): Promise<unknown> },
  reason: string,
  context: AuditContext,
): Promise<void> {
  const from = invoice.status;
  await transition(invoice, InvoiceStatus.REVIEW_REQUIRED);
  invoice.approvalStatus = 'NOT_REQUIRED';
  invoice.approvalRequestId = undefined;
  await invoice.save();

  const { cancel: cancelApproval } = await import('../approvals/approval.service.js');
  await cancelApproval(invoice._id, reason, context);

  await audit.recordStatusChange(
    {
      event: 'invoice.returned_to_review',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.trackingId,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: InvoiceStatus.REVIEW_REQUIRED,
      reason,
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.INVOICE_RETURNED_TO_REVIEW,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'INVOICE',
    entityId: String(invoice._id),
    recipientUserIds: invoice.submittedBy ? [String(invoice.submittedBy)] : [],
    title: `${invoice.trackingId} was returned for correction`,
    body: reason,
    link: `/invoices/${String(invoice._id)}`,
  });
}

/** Roles that review invoices, so they hear about a suspected duplicate. */
const DUPLICATE_ALERT_ROLES: RoleKey[] = rolesHolding('invoice:resolve_duplicate');

/** Roles that run the accounting stage. */
const ACCOUNTING_ROLES: RoleKey[] = rolesHolding('invoice:verify');

function rolesHolding(permission: Permission): RoleKey[] {
  return ROLE_KEYS.filter((role) =>
    ROLE_PERMISSIONS[role as RoleKey].includes(permission),
  ) as RoleKey[];
}

/**
 * Hands a business-cleared invoice to the accounting team.
 *
 * The single place this move happens — the approval dispatcher and the
 * auto-approve branch of submit both call it — so no future caller can put an
 * invoice into APPROVED, and therefore into the payment queue, without
 * accounting having seen it.
 */
export async function advanceToAccounting(
  invoice: InvoiceDoc & { _id: Types.ObjectId; save(): Promise<unknown> },
  context: AuditContext,
): Promise<void> {
  const from = invoice.status;
  await transition(invoice, InvoiceStatus.ACCOUNTING_VERIFICATION);
  await invoice.save();

  await audit.recordStatusChange(
    {
      event: 'invoice.awaiting_accounting',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.trackingId,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: InvoiceStatus.ACCOUNTING_VERIFICATION,
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.INVOICE_AWAITING_ACCOUNTING,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'INVOICE',
    entityId: String(invoice._id),
    recipientUserIds: [],
    recipientRoleKeys: ACCOUNTING_ROLES,
    title: `${invoice.trackingId} is ready for accounting`,
    body: `${invoice.vendorName ?? 'An invoice'} for ${formatINR(invoice.totalAmount ?? 0)} has cleared business approval and needs verification.`,
    link: `/accounting/${String(invoice._id)}`,
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
    invoice.findings
      .filter((finding) => finding.resolved)
      .map((finding) => [finding.code, finding]),
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
