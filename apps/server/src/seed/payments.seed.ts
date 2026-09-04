import { Types } from 'mongoose';
import {
  ApprovalStatus,
  InvoiceStatus,
  ObligationType,
  PaymentStatus,
  ReconciliationStatus,
  toMinor,
} from '@fpc/shared';
import { logger } from '../config/logger.js';
import { BankStatement, BankTransaction, Reconciliation } from '../models/banking.model.js';
import { Invoice } from '../models/invoice.model.js';
import { PaymentBatch, PaymentBatchItem } from '../models/paymentBatch.model.js';
import { PaymentObligation } from '../models/paymentObligation.model.js';
import { Vendor } from '../models/vendor.model.js';
import { audit } from '../modules/audit/audit.service.js';
import { createBatch, exportBatch } from '../modules/payments/paymentBatch.service.js';
import { COMPANIES } from './data.org.js';
import { SETTLED_INVOICE } from './data.invoices.js';
import { attachInvoiceDocument } from './documents.seed.js';
import { actor, daysFromNow, keyOf, user, type SeedContext } from './context.js';

const MAKER = 'ravi@nova.example.com';
const CHECKER = 'financemanager@nova.example.com';

export interface PaymentClusterResult {
  /** Payment batch ids by the label used elsewhere in the seed. */
  batchIds: Record<string, Types.ObjectId>;
  batches: number;
}

/**
 * Payment batches resting in each status the product can actually leave one in.
 *
 * `exportBatch` walks DRAFT → READY → EXPORTED → PROCESSING inside a single
 * call, so READY and EXPORTED are transient by construction and no batch is
 * seeded in them; nor is CANCELLED or COMPLETED, which no route produces. The
 * reachable resting statuses are DRAFT, PROCESSING, PARTIALLY_RECONCILED and
 * RECONCILED, and there is one of each.
 */
export async function seedPaymentClusters(context: SeedContext): Promise<PaymentClusterResult> {
  const batchIds: Record<string, Types.ObjectId> = {};
  let batches = 0;

  const clusters = [
    { label: 'draft', paymentDate: daysFromNow(-2), invoices: ['INV-5501'], export: false },
    { label: 'processing', paymentDate: daysFromNow(-5), invoices: ['INV-5502'], export: true },
    {
      label: 'partial',
      paymentDate: daysFromNow(-6),
      invoices: ['INV-5503', 'INV-5504'],
      export: true,
    },
  ];

  for (const cluster of clusters) {
    const created = await buildCluster(context, cluster);
    if (!created) continue;
    batchIds[cluster.label] = created;
    batches += 1;
  }

  return { batchIds, batches };
}

async function buildCluster(
  context: SeedContext,
  cluster: { label: string; paymentDate: Date; invoices: string[]; export: boolean },
): Promise<Types.ObjectId | null> {
  const companyId = context.companyIds.engineering!;
  const maker = user(context, MAKER);
  const checker = user(context, CHECKER);

  const invoices = await Invoice.find({
    tenantId: context.tenantId,
    companyId,
    invoiceNumber: { $in: cluster.invoices },
  })
    .select('_id obligationId invoiceNumber')
    .lean();

  const obligationIds = invoices.map((entry) => entry.obligationId).filter(Boolean);
  if (obligationIds.length !== cluster.invoices.length) {
    logger.warn({ cluster: cluster.label }, 'seed: cluster invoices have no obligation; skipping');
    return null;
  }

  // Idempotency is keyed off the driving obligation, never off the batch
  // reference: `PB-YYYYMMDD-NNN` embeds a relative date and so changes daily.
  const alreadyBatched = await PaymentObligation.exists({
    _id: obligationIds[0],
    paymentBatchId: { $exists: true },
  });
  if (alreadyBatched) return null;

  const batch = await createBatch(
    {
      tenantId: context.tenantId,
      companyId,
      paymentDate: cluster.paymentDate,
      bankAccountId: context.bankAccountIds['engineering:ops'],
      obligationIds: obligationIds as Types.ObjectId[],
      createdBy: maker.id,
    },
    actor(context, MAKER),
  );

  if (!cluster.export) return batch._id;

  await exportBatch(batch._id, { userId: checker.id, name: checker.name }, actor(context, CHECKER));

  // The matcher scores proximity to when the file went to the bank. Left at
  // "now" every seeded debit would look days early, so the export is aged to
  // match the statement the seed writes next.
  await PaymentBatch.updateOne({ _id: batch._id }, { exportedAt: cluster.paymentDate });

  return batch._id;
}

/**
 * Puts one approved payment on hold, so the queue shows the state and the
 * release action has something to act on.
 */
export async function seedHeldObligation(context: SeedContext): Promise<void> {
  const invoice = await Invoice.findOne({
    tenantId: context.tenantId,
    companyId: context.companyIds.engineering,
    invoiceNumber: 'INV-2210',
  })
    .select('obligationId')
    .lean();
  if (!invoice?.obligationId) return;

  const obligation = await PaymentObligation.findById(invoice.obligationId);
  // Guard on the current status so a re-run without --reset is a no-op rather
  // than an illegal transition.
  if (!obligation || obligation.paymentStatus !== PaymentStatus.QUEUED) return;

  obligation.paymentStatus = PaymentStatus.ON_HOLD;
  obligation.holdReason = 'Awaiting a credit note from the vendor';
  await obligation.save();

  await audit.record(
    {
      event: 'obligation.held',
      entityType: 'PAYMENT_OBLIGATION',
      entityId: obligation._id,
      entityLabel: `${obligation.payeeName} ${obligation.reference}`,
      tenantId: obligation.tenantId,
      companyId: obligation.companyId,
      metadata: { reason: obligation.holdReason },
    },
    actor(context, MAKER),
  );
}

/**
 * One invoice that has already been paid and reconciled, so the dashboard,
 * reports and audit trail have history on first load.
 *
 * Written as a complete chain — obligation, batch, statement, transaction and
 * reconciliation — rather than as an invoice with `status: PAID`, because a
 * paid invoice with nothing behind it is exactly the fiction the product is
 * built to refuse.
 */
export async function seedSettledPayment(context: SeedContext): Promise<number> {
  const tenantId = context.tenantId;
  const companyId = context.companyIds.engineering!;
  const bankAccountId = context.bankAccountIds['engineering:ops']!;
  const createdBy = user(context, MAKER).id;
  const exportedBy = user(context, CHECKER).id;
  const reference = SETTLED_INVOICE.invoiceNumber;

  if (await Invoice.exists({ tenantId, companyId, invoiceNumber: reference })) return 0;

  const vendor = await Vendor.findById(
    context.vendorIds[keyOf(SETTLED_INVOICE.company, SETTLED_INVOICE.vendor)],
  ).lean();
  if (!vendor) return 0;

  const paidOn = daysFromNow(-SETTLED_INVOICE.paidDaysAgo);
  const amount = toMinor(SETTLED_INVOICE.total);

  const invoice = await Invoice.create({
    tenantId,
    companyId,
    vendorId: vendor._id,
    vendorName: vendor.name,
    invoiceNumber: reference,
    invoiceDate: daysFromNow(-SETTLED_INVOICE.daysAgo),
    dueDate: daysFromNow(SETTLED_INVOICE.dueInDays),
    currency: 'INR',
    subtotal: toMinor(SETTLED_INVOICE.subtotal),
    taxAmount: toMinor(SETTLED_INVOICE.tax),
    totalAmount: amount,
    status: InvoiceStatus.RECONCILED,
    source: 'UPLOAD',
    receivedAt: daysFromNow(-SETTLED_INVOICE.daysAgo),
    approvalStatus: ApprovalStatus.APPROVED,
    submittedBy: createdBy,
    paidAt: paidOn,
    reconciledAt: paidOn,
    findings: [],
  });

  const batch = await PaymentBatch.create({
    tenantId,
    companyId,
    reference: `PB-${paidOn.toISOString().slice(0, 10).replace(/-/g, '')}-001`,
    paymentDate: paidOn,
    status: 'RECONCILED',
    bankAccountId,
    bankFileFormat: 'HDFC',
    itemCount: 1,
    totalAmount: amount,
    vendorAmount: amount,
    vendorCount: 1,
    payrollAmount: 0,
    payrollCount: 0,
    reconciledAmount: amount,
    reconciledCount: 1,
    exportFileName: 'PB-seed.xlsx',
    exportedAt: paidOn,
    exportedBy,
    createdBy,
  });

  const obligation = await PaymentObligation.create({
    tenantId,
    companyId,
    type: ObligationType.VENDOR,
    sourceId: invoice._id,
    reference,
    payeeName: vendor.name,
    beneficiaryName: vendor.name,
    beneficiaryAccount: vendor.bankAccountNumber!,
    ifsc: vendor.ifsc!,
    amount,
    currency: 'INR',
    dueDate: invoice.dueDate,
    approvalStatus: ApprovalStatus.APPROVED,
    paymentStatus: PaymentStatus.PAID,
    reconciliationStatus: ReconciliationStatus.MATCHED,
    paymentBatchId: batch._id,
    paymentBatchReference: batch.reference,
    paidAt: paidOn,
    reconciledAt: paidOn,
  });

  invoice.obligationId = obligation._id;
  invoice.paymentBatchId = batch._id;
  await attachInvoiceDocument(invoice, {
    fileName: `${reference}.pdf`,
    description: 'Structural steel supply',
    gstin: vendor.gstin,
    companyName: COMPANIES.find((entry) => entry.key === SETTLED_INVOICE.company)!.name,
    uploadedBy: createdBy,
  });
  await invoice.save();

  await PaymentBatchItem.create({
    tenantId,
    companyId,
    paymentBatchId: batch._id,
    obligationId: obligation._id,
    type: ObligationType.VENDOR,
    beneficiaryName: vendor.name,
    beneficiaryAccount: vendor.bankAccountNumber!,
    ifsc: vendor.ifsc!,
    amount,
    reference,
    reconciliationStatus: ReconciliationStatus.MATCHED,
  });

  const statement = await BankStatement.create({
    tenantId,
    companyId,
    bankAccountId,
    fileName: 'HDFC_Statement_seed.xlsx',
    status: 'PARSED',
    periodStart: daysFromNow(-10),
    periodEnd: daysFromNow(-7),
    transactionCount: 1,
    duplicateCount: 0,
    totalDebit: amount,
    totalCredit: 0,
    uploadedBy: createdBy,
  });

  const transaction = await BankTransaction.create({
    tenantId,
    companyId,
    bankAccountId,
    bankStatementId: statement._id,
    transactionDate: paidOn,
    description: `NEFT ${vendor.name.toUpperCase()}`,
    reference: batch.reference,
    direction: 'DEBIT',
    amount,
    reconciliationStatus: ReconciliationStatus.MATCHED,
    dedupeHash: `seed-${String(obligation._id)}`,
  });

  const reconciliation = await Reconciliation.create({
    tenantId,
    companyId,
    bankTransactionId: transaction._id,
    obligationId: obligation._id,
    paymentBatchId: batch._id,
    status: ReconciliationStatus.MATCHED,
    confidence: 97,
    method: 'AUTO_SUGGESTED',
    confirmedBy: createdBy,
    confirmedAt: paidOn,
  });

  obligation.bankTransactionId = transaction._id;
  await obligation.save();
  transaction.reconciliationId = reconciliation._id;
  await transaction.save();

  return 1;
}
