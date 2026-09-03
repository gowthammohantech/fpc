import { Types } from 'mongoose';
import {
  ValidationCode,
  ValidationSeverity,
  amountsMatch,
  formatINR,
  normalizeInvoiceNumber,
  type ValidationFinding,
} from '@fpc/shared';
import { env } from '../../config/env.js';
import { Invoice, type InvoiceDoc } from '../../models/invoice.model.js';

/**
 * Invoice validation — PRD §13.
 *
 * Deliberately simple: required fields, an arithmetic check, and duplicate
 * detection. Anything an ERP would do (PO matching, GRN, tax computation) is
 * out of scope for the MVP.
 */

export interface ValidationInput {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  invoice: Pick<
    InvoiceDoc,
    | 'vendorId'
    | 'vendorName'
    | 'invoiceNumber'
    | 'invoiceDate'
    | 'dueDate'
    | 'subtotal'
    | 'taxAmount'
    | 'totalAmount'
    | 'extraction'
  >;
  /** Excluded from duplicate comparison so an invoice never matches itself. */
  excludeInvoiceId?: Types.ObjectId;
}

export async function validateInvoice(input: ValidationInput): Promise<ValidationFinding[]> {
  return [
    ...requiredFieldFindings(input.invoice),
    ...arithmeticFindings(input.invoice),
    ...lowConfidenceFindings(input.invoice),
    ...(await duplicateFindings(input)),
  ];
}

/** Blocking problems — an invoice cannot be submitted while any of these stand. */
export function blockingFindings(findings: ValidationFinding[]): ValidationFinding[] {
  return findings.filter(
    (finding) =>
      !finding.resolved &&
      (finding.severity === ValidationSeverity.ERROR ||
        finding.code === ValidationCode.POSSIBLE_DUPLICATE ||
        finding.code === ValidationCode.EXACT_DUPLICATE),
  );
}

function requiredFieldFindings(invoice: ValidationInput['invoice']): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const required: Array<[boolean, ValidationCode, string, string]> = [
    [
      !invoice.vendorId && !invoice.vendorName,
      ValidationCode.MISSING_VENDOR,
      'vendorId',
      'Vendor is required',
    ],
    [
      !invoice.invoiceNumber,
      ValidationCode.MISSING_INVOICE_NUMBER,
      'invoiceNumber',
      'Invoice number is required',
    ],
    [
      !invoice.invoiceDate,
      ValidationCode.MISSING_INVOICE_DATE,
      'invoiceDate',
      'Invoice date is required',
    ],
    [
      invoice.totalAmount === undefined || invoice.totalAmount === null,
      ValidationCode.MISSING_TOTAL,
      'totalAmount',
      'Total amount is required',
    ],
  ];

  for (const [missing, code, field, message] of required) {
    if (missing) {
      findings.push({ code, severity: ValidationSeverity.ERROR, message, field });
    }
  }
  return findings;
}

function arithmeticFindings(invoice: ValidationInput['invoice']): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const { subtotal, taxAmount, totalAmount } = invoice;

  if (typeof totalAmount === 'number' && totalAmount <= 0) {
    findings.push({
      code: ValidationCode.NEGATIVE_AMOUNT,
      severity: ValidationSeverity.ERROR,
      message: 'Total amount must be greater than zero',
      field: 'totalAmount',
    });
  }

  // subtotal + tax ≈ total (PRD §13). Only checked when all three are present;
  // many invoices legitimately state only a total.
  if (
    typeof subtotal === 'number' &&
    typeof taxAmount === 'number' &&
    typeof totalAmount === 'number' &&
    !amountsMatch(subtotal + taxAmount, totalAmount)
  ) {
    findings.push({
      code: ValidationCode.TOTAL_MISMATCH,
      severity: ValidationSeverity.WARNING,
      message:
        `Subtotal ${formatINR(subtotal)} + tax ${formatINR(taxAmount)} = ` +
        `${formatINR(subtotal + taxAmount)}, which does not match the stated total ${formatINR(totalAmount)}`,
      field: 'totalAmount',
    });
  }

  if (invoice.invoiceDate && invoice.dueDate && invoice.dueDate < invoice.invoiceDate) {
    findings.push({
      code: ValidationCode.DUE_DATE_BEFORE_INVOICE_DATE,
      severity: ValidationSeverity.WARNING,
      message: 'Due date is earlier than the invoice date',
      field: 'dueDate',
    });
  }

  return findings;
}

/** Flags fields the extractor was unsure about, so review focuses on them. */
function lowConfidenceFindings(invoice: ValidationInput['invoice']): ValidationFinding[] {
  const fields = invoice.extraction?.fields;
  if (!fields) return [];

  return Object.entries(fields)
    .filter(([, field]) => !field.edited && field.confidence < env.OCR_REVIEW_THRESHOLD)
    .map(([name, field]) => ({
      code: ValidationCode.LOW_CONFIDENCE_FIELD,
      severity: ValidationSeverity.INFO,
      message: `${name} was extracted with ${Math.round(field.confidence * 100)}% confidence — please verify`,
      field: name,
    }));
}

/**
 * Duplicate detection — PRD §13.
 *
 * Two passes. An exact match on vendor + normalised invoice number is almost
 * certainly the same bill arriving twice. A fuzzy match on vendor + amount
 * within a date window catches the same invoice re-sent under a slightly
 * different reference, which is the case that actually causes double payments.
 */
const DUPLICATE_DATE_WINDOW_DAYS = 7;

async function duplicateFindings(input: ValidationInput): Promise<ValidationFinding[]> {
  const { invoice, tenantId, companyId, excludeInvoiceId } = input;
  if (!invoice.vendorId) return [];

  const base: Record<string, unknown> = {
    tenantId,
    companyId,
    vendorId: invoice.vendorId,
    // A previously rejected or cancelled bill is not a duplicate risk.
    status: { $nin: ['CANCELLED', 'REJECTED', 'DUPLICATE'] },
    ...(excludeInvoiceId ? { _id: { $ne: excludeInvoiceId } } : {}),
  };

  const findings: ValidationFinding[] = [];

  const normalized = normalizeInvoiceNumber(invoice.invoiceNumber);
  if (normalized) {
    const exact = await Invoice.find({ ...base, invoiceNumberNormalized: normalized })
      .select('_id invoiceNumber totalAmount invoiceDate status')
      .limit(5)
      .lean();

    if (exact.length) {
      findings.push({
        code: ValidationCode.EXACT_DUPLICATE,
        severity: ValidationSeverity.WARNING,
        message:
          `Invoice ${invoice.invoiceNumber} already exists for this vendor ` +
          `(${exact.map((doc) => doc.status).join(', ')}). Confirm this is not a duplicate before submitting.`,
        field: 'invoiceNumber',
        relatedEntityIds: exact.map((doc) => String(doc._id)),
      });
      // An exact hit makes the weaker signal redundant.
      return findings;
    }
  }

  if (typeof invoice.totalAmount === 'number' && invoice.invoiceDate) {
    const from = new Date(invoice.invoiceDate);
    from.setDate(from.getDate() - DUPLICATE_DATE_WINDOW_DAYS);
    const to = new Date(invoice.invoiceDate);
    to.setDate(to.getDate() + DUPLICATE_DATE_WINDOW_DAYS);

    const similar = await Invoice.find({
      ...base,
      totalAmount: invoice.totalAmount,
      invoiceDate: { $gte: from, $lte: to },
    })
      .select('_id invoiceNumber totalAmount invoiceDate')
      .limit(5)
      .lean();

    if (similar.length) {
      findings.push({
        code: ValidationCode.POSSIBLE_DUPLICATE,
        severity: ValidationSeverity.WARNING,
        message:
          `An invoice for ${formatINR(invoice.totalAmount)} from this vendor was already recorded ` +
          `around this date (${similar.map((doc) => doc.invoiceNumber ?? 'no number').join(', ')}).`,
        relatedEntityIds: similar.map((doc) => String(doc._id)),
      });
    }
  }

  return findings;
}
