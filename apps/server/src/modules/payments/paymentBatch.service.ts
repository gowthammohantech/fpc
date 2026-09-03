import { Types } from 'mongoose';
import {
  InvoiceStatus,
  NotificationType,
  ObligationType,
  PaymentBatchStatus,
  PaymentStatus,
  formatINR,
  invoiceMachine,
  obligationPaymentMachine,
  paymentBatchMachine,
  type BankFileFormat,
} from '@fpc/shared';
import { ApiError } from '../../core/errors.js';
import { eventBus } from '../../core/eventBus.js';
import { storage } from '../../integrations/storage/index.js';
import { BankAccount } from '../../models/bankAccount.model.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { Invoice } from '../../models/invoice.model.js';
import { PaymentBatch, PaymentBatchItem } from '../../models/paymentBatch.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { generateBankFile, transactionTypeFor } from './bankFormats/index.js';

export interface CreateBatchInput {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  paymentDate: Date;
  bankAccountId?: Types.ObjectId;
  bankFileFormat?: BankFileFormat;
  obligationIds: Types.ObjectId[];
  notes?: string;
  createdBy: Types.ObjectId;
}

/**
 * Creates a payment batch from selected obligations — PRD §12/§22.
 *
 * Only obligations that are approved and not already in a batch qualify. The
 * batch is the unit the bank sees, so its totals are split by type to match
 * the PRD's vendor/payroll breakdown.
 */
export async function createBatch(input: CreateBatchInput, context: AuditContext) {
  const obligations = await PaymentObligation.find({
    _id: { $in: input.obligationIds },
    tenantId: input.tenantId,
    companyId: input.companyId,
    approvalStatus: 'APPROVED',
    paymentStatus: { $in: [PaymentStatus.QUEUED, PaymentStatus.PENDING] },
  });

  if (!obligations.length) {
    throw ApiError.unprocessable(
      'None of the selected payments are available for batching. They may already be in another batch, or on hold.',
    );
  }
  if (obligations.length !== input.obligationIds.length) {
    const found = new Set(obligations.map((entry) => String(entry._id)));
    const missing = input.obligationIds.filter((id) => !found.has(String(id)));
    throw ApiError.conflict(
      `${missing.length} of the selected payments are no longer available for batching. Refresh the queue and try again.`,
      { unavailableObligationIds: missing.map(String) },
    );
  }

  const bankAccount = input.bankAccountId
    ? await BankAccount.findOne({ _id: input.bankAccountId, tenantId: input.tenantId }).lean()
    : null;

  const batch = await PaymentBatch.create({
    tenantId: input.tenantId,
    companyId: input.companyId,
    reference: await nextBatchReference(input.tenantId, input.paymentDate),
    paymentDate: input.paymentDate,
    status: PaymentBatchStatus.DRAFT,
    bankAccountId: bankAccount?._id,
    bankFileFormat: input.bankFileFormat ?? bankAccount?.bankFileFormat ?? 'GENERIC_XLSX',
    notes: input.notes,
    createdBy: input.createdBy,
    ...totalsOf(obligations),
  });

  await PaymentBatchItem.insertMany(
    obligations.map((obligation) => ({
      tenantId: obligation.tenantId,
      companyId: obligation.companyId,
      paymentBatchId: batch._id,
      obligationId: obligation._id,
      type: obligation.type,
      beneficiaryName: obligation.beneficiaryName,
      beneficiaryAccount: obligation.beneficiaryAccount,
      ifsc: obligation.ifsc,
      amount: obligation.amount,
      reference: obligation.reference,
      reconciliationStatus: 'UNMATCHED',
    })),
  );

  for (const obligation of obligations) {
    obligationPaymentMachine.assertTransition(obligation.paymentStatus, PaymentStatus.BATCHED);
    obligation.paymentStatus = PaymentStatus.BATCHED;
    obligation.paymentBatchId = batch._id;
    obligation.paymentBatchReference = batch.reference;
    await obligation.save();
  }

  await advanceInvoices(obligations, InvoiceStatus.PAYMENT_BATCHED, batch._id);

  await audit.record(
    {
      event: 'payment_batch.created',
      entityType: 'PAYMENT_BATCH',
      entityId: batch._id,
      entityLabel: batch.reference,
      tenantId: input.tenantId,
      companyId: input.companyId,
      newValue: {
        itemCount: batch.itemCount,
        totalAmount: batch.totalAmount,
        vendorAmount: batch.vendorAmount,
        payrollAmount: batch.payrollAmount,
        paymentDate: batch.paymentDate,
      },
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.PAYMENT_BATCH_GENERATED,
    tenantId: String(input.tenantId),
    companyId: String(input.companyId),
    entityType: 'PAYMENT_BATCH',
    entityId: String(batch._id),
    recipientUserIds: [String(input.createdBy)],
    title: `Payment batch ${batch.reference} created`,
    body: `${batch.itemCount} payments totalling ${formatINR(batch.totalAmount)} are ready for the bank file.`,
    link: `/payments/batches/${String(batch._id)}`,
  });

  return batch;
}

/**
 * Generates the bank upload file and marks the batch EXPORTED — PRD §23.
 *
 * Maker–checker: the person who assembled the batch may not be the one who
 * exports it for the bank, mirroring the segregation of duties applied to
 * approvals.
 */
export async function exportBatch(
  batchId: Types.ObjectId,
  actor: { userId: Types.ObjectId; name: string; canOverrideMakerChecker?: boolean },
  context: AuditContext,
) {
  const batch = await PaymentBatch.findById(batchId);
  if (!batch) throw ApiError.notFound('Payment batch');

  if (batch.status !== PaymentBatchStatus.DRAFT && batch.status !== PaymentBatchStatus.READY) {
    throw ApiError.conflict(`Batch ${batch.reference} is already ${batch.status.toLowerCase()}`);
  }
  if (batch.createdBy.equals(actor.userId) && !actor.canOverrideMakerChecker) {
    throw ApiError.forbidden(
      'You created this batch, so another user must export it for the bank (maker–checker).',
    );
  }

  const items = await PaymentBatchItem.find({ paymentBatchId: batch._id }).lean();
  if (!items.length) throw ApiError.unprocessable('This batch has no payments to export');

  const bankAccount = batch.bankAccountId
    ? await BankAccount.findById(batch.bankAccountId).lean()
    : null;

  // Vendor emails are included so the bank can send its own advice; payroll
  // rows deliberately carry none.
  const vendorEmails = await vendorEmailsFor(items);

  const file = await generateBankFile(
    batch.bankFileFormat,
    batch.reference,
    items.map((item) => ({
      beneficiaryName: item.beneficiaryName,
      beneficiaryAccount: item.beneficiaryAccount,
      ifsc: item.ifsc,
      amount: item.amount,
      reference: `${batch.reference}/${item.reference}`.slice(0, 60),
      paymentDate: batch.paymentDate,
      email:
        item.type === ObligationType.VENDOR
          ? vendorEmails.get(String(item.obligationId))
          : undefined,
      transactionType: transactionTypeFor(item.amount),
      debitAccount: bankAccount?.accountNumber,
    })),
  );

  const stored = await storage().put({
    key: `bank-files/${String(batch.companyId)}/${file.fileName}`,
    body: file.buffer,
    contentType: file.contentType,
  });

  const document = await DocumentFile.create({
    tenantId: batch.tenantId,
    companyId: batch.companyId,
    key: stored.key,
    fileName: file.fileName,
    contentType: stored.contentType,
    size: stored.size,
    checksum: stored.checksum,
    driver: storage().name,
    uploadedBy: actor.userId,
    kind: 'BANK_FILE',
  });

  if (batch.status === PaymentBatchStatus.DRAFT) {
    paymentBatchMachine.assertTransition(batch.status, PaymentBatchStatus.READY);
    batch.status = PaymentBatchStatus.READY;
  }
  paymentBatchMachine.assertTransition(batch.status, PaymentBatchStatus.EXPORTED);
  batch.status = PaymentBatchStatus.EXPORTED;
  batch.exportFileId = document._id;
  batch.exportFileName = file.fileName;
  batch.exportedAt = new Date();
  batch.exportedBy = actor.userId;
  await batch.save();

  // From here the money is with the bank; the platform waits for the
  // statement (PRD §23).
  paymentBatchMachine.assertTransition(batch.status, PaymentBatchStatus.PROCESSING);
  batch.status = PaymentBatchStatus.PROCESSING;
  await batch.save();

  const obligations = await PaymentObligation.find({ paymentBatchId: batch._id });
  for (const obligation of obligations) {
    obligationPaymentMachine.assertTransition(obligation.paymentStatus, PaymentStatus.PROCESSING);
    obligation.paymentStatus = PaymentStatus.PROCESSING;
    await obligation.save();
  }
  await advanceInvoices(obligations, InvoiceStatus.PAYMENT_PROCESSING, batch._id);

  await audit.record(
    {
      event: 'payment_batch.exported',
      entityType: 'PAYMENT_BATCH',
      entityId: batch._id,
      entityLabel: batch.reference,
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      metadata: {
        fileName: file.fileName,
        format: batch.bankFileFormat,
        itemCount: items.length,
        totalAmount: batch.totalAmount,
        checksum: stored.checksum,
        exportedBy: actor.name,
      },
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.PAYMENT_BATCH_EXPORTED,
    tenantId: String(batch.tenantId),
    companyId: String(batch.companyId),
    entityType: 'PAYMENT_BATCH',
    entityId: String(batch._id),
    recipientUserIds: [String(batch.createdBy), String(actor.userId)],
    title: `Bank file ready for ${batch.reference}`,
    body: `${file.fileName} covering ${formatINR(batch.totalAmount)} is ready to upload to the bank.`,
    link: `/payments/batches/${String(batch._id)}`,
  });

  return { batch, document, file };
}

/** Removes an obligation from a draft batch, returning it to the queue. */
export async function removeFromBatch(
  batchId: Types.ObjectId,
  obligationIds: Types.ObjectId[],
  context: AuditContext,
) {
  const batch = await PaymentBatch.findById(batchId);
  if (!batch) throw ApiError.notFound('Payment batch');
  if (batch.status !== PaymentBatchStatus.DRAFT) {
    throw ApiError.conflict('Only a draft batch can be changed. Cancel it and create a new one.');
  }

  await PaymentBatchItem.deleteMany({
    paymentBatchId: batch._id,
    obligationId: { $in: obligationIds },
  });

  const obligations = await PaymentObligation.find({
    _id: { $in: obligationIds },
    paymentBatchId: batch._id,
  });
  for (const obligation of obligations) {
    obligation.paymentStatus = PaymentStatus.QUEUED;
    obligation.paymentBatchId = undefined;
    obligation.paymentBatchReference = undefined;
    await obligation.save();
  }
  await advanceInvoices(obligations, InvoiceStatus.PAYMENT_PENDING, undefined);

  const remaining = await PaymentObligation.find({ paymentBatchId: batch._id }).lean();
  Object.assign(batch, totalsOf(remaining));
  await batch.save();

  await audit.record(
    {
      event: 'payment_batch.items_removed',
      entityType: 'PAYMENT_BATCH',
      entityId: batch._id,
      entityLabel: batch.reference,
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      metadata: { removed: obligationIds.map(String) },
    },
    context,
  );

  return batch;
}

/** Recomputes reconciliation rollups after a match is confirmed (PRD §22). */
export async function refreshReconciliationTotals(batchId: Types.ObjectId): Promise<void> {
  const batch = await PaymentBatch.findById(batchId);
  if (!batch) return;

  const obligations = await PaymentObligation.find({ paymentBatchId: batch._id })
    .select('reconciliationStatus amount')
    .lean();

  const matched = obligations.filter((entry) => entry.reconciliationStatus === 'MATCHED');
  batch.reconciledCount = matched.length;
  batch.reconciledAmount = matched.reduce((sum, entry) => sum + entry.amount, 0);

  const next =
    obligations.length && matched.length === obligations.length
      ? PaymentBatchStatus.RECONCILED
      : matched.length
        ? PaymentBatchStatus.PARTIALLY_RECONCILED
        : batch.status;

  if (next !== batch.status && paymentBatchMachine.canTransition(batch.status, next)) {
    batch.status = next;
  }
  await batch.save();
}

function totalsOf(obligations: Array<{ type: string; amount: number }>) {
  const vendor = obligations.filter((entry) => entry.type === ObligationType.VENDOR);
  const payroll = obligations.filter((entry) => entry.type === ObligationType.PAYROLL);
  const sum = (rows: Array<{ amount: number }>) =>
    rows.reduce((total, row) => total + row.amount, 0);

  return {
    itemCount: obligations.length,
    totalAmount: sum(obligations),
    vendorAmount: sum(vendor),
    vendorCount: vendor.length,
    payrollAmount: sum(payroll),
    payrollCount: payroll.length,
  };
}

/** Moves the invoices behind vendor obligations along their own lifecycle. */
async function advanceInvoices(
  obligations: Array<{ type: string; sourceId: Types.ObjectId }>,
  to: InvoiceStatus,
  paymentBatchId: Types.ObjectId | undefined,
): Promise<void> {
  const invoiceIds = obligations
    .filter((entry) => entry.type === ObligationType.VENDOR)
    .map((entry) => entry.sourceId);
  if (!invoiceIds.length) return;

  const invoices = await Invoice.find({ _id: { $in: invoiceIds } });
  for (const invoice of invoices) {
    if (!invoiceMachine.canTransition(invoice.status, to)) continue;
    invoice.status = to;
    invoice.paymentBatchId = paymentBatchId;
    await invoice.save();
  }
}

async function vendorEmailsFor(
  items: Array<{ obligationId: Types.ObjectId; type: string }>,
): Promise<Map<string, string>> {
  const obligations = await PaymentObligation.find({
    _id: { $in: items.map((item) => item.obligationId) },
    type: ObligationType.VENDOR,
  })
    .select('_id sourceId')
    .lean();

  const invoices = await Invoice.find({ _id: { $in: obligations.map((entry) => entry.sourceId) } })
    .select('_id vendorId')
    .lean();
  const vendorByInvoice = new Map(
    invoices.map((invoice) => [String(invoice._id), invoice.vendorId]),
  );

  const vendors = await Vendor.find({
    _id: { $in: invoices.map((invoice) => invoice.vendorId).filter(Boolean) },
  })
    .select('_id email')
    .lean();
  const emailByVendor = new Map(vendors.map((vendor) => [String(vendor._id), vendor.email]));

  const result = new Map<string, string>();
  for (const obligation of obligations) {
    const vendorId = vendorByInvoice.get(String(obligation.sourceId));
    const email = vendorId ? emailByVendor.get(String(vendorId)) : undefined;
    if (email) result.set(String(obligation._id), email);
  }
  return result;
}

/**
 * Allocates the next PB-YYYYMMDD-NNN reference.
 *
 * Counts today's batches rather than keeping a counter document; batch
 * creation is a low-frequency, human-initiated action, and the unique index
 * on `reference` is the real guarantee.
 */
async function nextBatchReference(tenantId: Types.ObjectId, paymentDate: Date): Promise<string> {
  const stamp = paymentDate.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PB-${stamp}-`;

  const latest = await PaymentBatch.findOne({ tenantId, reference: { $regex: `^${prefix}` } })
    .sort({ reference: -1 })
    .select('reference')
    .lean();

  const sequence = latest ? Number(latest.reference.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}
