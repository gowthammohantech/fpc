import { Types } from 'mongoose';
import {
  ApprovalStatus,
  InvoiceStatus,
  ObligationType,
  PaymentStatus,
  ReconciliationStatus,
  invoiceMachine,
} from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../core/errors.js';
import { Invoice } from '../../models/invoice.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';

/**
 * Creates the payment obligation for an approved invoice (PRD §20).
 *
 * Two properties matter here:
 *
 *  1. It is idempotent. The unique index on (tenant, type, sourceId) plus this
 *     check mean a replayed approval can never produce a second instruction to
 *     pay the same invoice.
 *  2. Beneficiary details are snapshotted from the vendor master at this
 *     moment. A later edit to the vendor's bank account does not silently
 *     redirect a payment that has already been approved.
 */
export async function createObligationForInvoice(
  invoiceId: Types.ObjectId,
  context: AuditContext,
): Promise<Types.ObjectId | null> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return null;

  if (invoice.obligationId) {
    logger.debug({ invoiceId: String(invoiceId) }, 'obligation already exists for invoice');
    return invoice.obligationId;
  }
  if (invoice.status !== InvoiceStatus.APPROVED) {
    throw ApiError.conflict('Only an approved invoice becomes a payment obligation');
  }

  const vendor = invoice.vendorId ? await Vendor.findById(invoice.vendorId).lean() : null;
  if (!vendor) throw ApiError.unprocessable('The invoice has no vendor to pay');

  if (!vendor.bankAccountNumber || !vendor.ifsc) {
    // Better to stop here with a clear message than to generate a bank file
    // the bank will reject.
    throw ApiError.unprocessable(
      `Vendor ${vendor.name} has no bank account or IFSC on file. Add them in Settings → Vendors before this invoice can be paid.`,
    );
  }

  const obligation = await PaymentObligation.create({
    tenantId: invoice.tenantId,
    companyId: invoice.companyId,
    locationId: invoice.locationId,
    departmentId: invoice.departmentId,
    type: ObligationType.VENDOR,
    sourceId: invoice._id,
    reference: invoice.invoiceNumber ?? String(invoice._id),
    payeeName: vendor.name,
    beneficiaryName: vendor.beneficiaryName || vendor.name,
    beneficiaryAccount: vendor.bankAccountNumber,
    ifsc: vendor.ifsc,
    amount: invoice.totalAmount ?? 0,
    currency: 'INR',
    dueDate: invoice.dueDate,
    approvalStatus: ApprovalStatus.APPROVED,
    paymentStatus: PaymentStatus.QUEUED,
    reconciliationStatus: ReconciliationStatus.UNMATCHED,
  });

  const from = invoice.status;
  invoiceMachine.assertTransition(from, InvoiceStatus.PAYMENT_PENDING);
  invoice.status = InvoiceStatus.PAYMENT_PENDING;
  invoice.obligationId = obligation._id;
  await invoice.save();

  await audit.recordStatusChange(
    {
      event: 'obligation.created',
      entityType: 'PAYMENT_OBLIGATION',
      entityId: obligation._id,
      entityLabel: `${vendor.name} ${invoice.invoiceNumber ?? ''}`.trim(),
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: InvoiceStatus.PAYMENT_PENDING,
      metadata: {
        amount: obligation.amount,
        beneficiaryAccount: maskAccount(obligation.beneficiaryAccount),
        invoiceId: String(invoice._id),
      },
    },
    context,
  );

  return obligation._id;
}

export interface PayrollObligationRow {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  bankAccountNumber: string;
  ifsc: string;
  amount: number;
  locationId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
}

/**
 * Fans a payroll batch out into one obligation per employee (PRD §20).
 *
 * Written as a bulk insert with `ordered: false` so an 850-row batch is a
 * single round trip, and so a duplicate-key collision on one row (a replayed
 * approval) skips that row instead of failing the whole batch.
 */
export async function createObligationsForPayroll(
  input: {
    tenantId: Types.ObjectId;
    companyId: Types.ObjectId;
    batchId: Types.ObjectId;
    batchReference: string;
    paymentDate?: Date;
    rows: PayrollObligationRow[];
  },
  context: AuditContext,
): Promise<{ created: number; skipped: number }> {
  const documents = input.rows.map((row) => ({
    tenantId: input.tenantId,
    companyId: input.companyId,
    locationId: row.locationId,
    departmentId: row.departmentId,
    type: ObligationType.PAYROLL,
    sourceId: row.employeeId,
    sourceBatchId: input.batchId,
    reference: `${input.batchReference}/${row.employeeCode}`,
    payeeName: row.employeeName,
    beneficiaryName: row.employeeName,
    beneficiaryAccount: row.bankAccountNumber,
    ifsc: row.ifsc,
    amount: row.amount,
    currency: 'INR' as const,
    dueDate: input.paymentDate,
    approvalStatus: ApprovalStatus.APPROVED,
    paymentStatus: PaymentStatus.QUEUED,
    reconciliationStatus: ReconciliationStatus.UNMATCHED,
  }));

  let created = 0;
  try {
    const inserted = await PaymentObligation.insertMany(documents, { ordered: false });
    created = inserted.length;
  } catch (error) {
    // insertMany with ordered:false reports per-document failures but still
    // writes the rest; duplicates are expected on a replay and are not fatal.
    const result = error as { insertedDocs?: unknown[]; writeErrors?: Array<{ code: number }> };
    created = result.insertedDocs?.length ?? 0;
    const nonDuplicate = (result.writeErrors ?? []).filter((entry) => entry.code !== 11000);
    if (nonDuplicate.length) throw error;
  }

  const skipped = documents.length - created;
  await audit.record(
    {
      event: 'obligation.payroll_fanout',
      entityType: 'PAYMENT_OBLIGATION',
      entityId: input.batchId,
      entityLabel: input.batchReference,
      tenantId: input.tenantId,
      companyId: input.companyId,
      metadata: {
        created,
        skipped,
        totalAmount: documents.reduce((sum, row) => sum + row.amount, 0),
      },
    },
    context,
  );

  return { created, skipped };
}

/** Links an obligation's employee/invoice rows back for display. */
export function maskAccount(value: string): string {
  return value.length <= 4
    ? value
    : `${'X'.repeat(Math.min(6, value.length - 4))}${value.slice(-4)}`;
}
