import { Types } from 'mongoose';
import {
  InvoiceStatus,
  NotificationType,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ObligationType,
  PayrollBatchStatus,
  PaymentStatus,
  ReconciliationStatus,
  formatINR,
  invoiceMachine,
  payrollBatchMachine,
  type RoleKey,
} from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../core/errors.js';
import { eventBus } from '../../core/eventBus.js';
import { BankStatement, BankTransaction, Reconciliation } from '../../models/banking.model.js';
import { Invoice } from '../../models/invoice.model.js';
import { PaymentBatch, PaymentBatchItem } from '../../models/paymentBatch.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { PayrollBatch } from '../../models/payroll.model.js';
import { User } from '../../models/user.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { refreshReconciliationTotals } from '../payments/paymentBatch.service.js';
import { bestMatch, rank, type MatchCandidate } from './match.engine.js';

/**
 * Runs the matcher over the unmatched debits of a statement and records
 * suggestions (PRD §25).
 *
 * Nothing is marked paid here. Suggestions are written with status SUGGESTED
 * so the reconciliation screen can present them for confirmation.
 */
export async function suggestMatchesForStatement(
  statementId: Types.ObjectId,
  context: AuditContext,
): Promise<{ suggested: number; unmatched: number }> {
  const transactions = await BankTransaction.find({
    bankStatementId: statementId,
    direction: 'DEBIT',
    reconciliationStatus: ReconciliationStatus.UNMATCHED,
  });

  let suggested = 0;

  for (const transaction of transactions) {
    const candidates = await candidatesFor(transaction.tenantId, transaction.companyId, transaction.amount);
    const match = bestMatch(
      {
        amount: transaction.amount,
        description: transaction.description,
        reference: transaction.reference,
        utr: transaction.utr,
        transactionDate: transaction.transactionDate,
      },
      candidates,
    );
    if (!match) continue;

    const reconciliation = await Reconciliation.create({
      tenantId: transaction.tenantId,
      companyId: transaction.companyId,
      bankTransactionId: transaction._id,
      obligationId: new Types.ObjectId(match.candidateId),
      status: ReconciliationStatus.SUGGESTED,
      confidence: match.confidence,
      method: 'AUTO_SUGGESTED',
      signals: match.signals,
    });

    transaction.reconciliationStatus = ReconciliationStatus.SUGGESTED;
    transaction.reconciliationId = reconciliation._id;
    await transaction.save();

    await PaymentObligation.updateOne(
      { _id: match.candidateId },
      { reconciliationStatus: ReconciliationStatus.SUGGESTED },
    );
    suggested += 1;
  }

  const unmatched = transactions.length - suggested;

  await audit.record(
    {
      event: 'reconciliation.suggestions_generated',
      entityType: 'BANK_STATEMENT',
      entityId: statementId,
      tenantId: transactions[0]?.tenantId ?? new Types.ObjectId(),
      companyId: transactions[0]?.companyId,
      metadata: { debits: transactions.length, suggested, unmatched },
    },
    context,
  );

  if (unmatched > 0 && transactions[0]) {
    const first = transactions[0];
    eventBus.publish({
      type: NotificationType.RECONCILIATION_UNMATCHED,
      tenantId: String(first.tenantId),
      companyId: String(first.companyId),
      entityType: 'BANK_STATEMENT',
      entityId: String(statementId),
      // Without recipients this event is published and then dropped, which is
      // how it silently did nothing before.
      recipientUserIds: await reconcilerUserIds(first.tenantId, first.companyId, statementId),
      title: `${unmatched} bank ${unmatched === 1 ? 'transaction needs' : 'transactions need'} manual reconciliation`,
      body: `The latest statement import produced ${suggested} suggested matches and ${unmatched} unmatched debits.`,
      link: '/reconciliation',
    });
  }

  return { suggested, unmatched };
}

/** Ranked suggestions for one transaction, for the manual match dialog. */
export async function candidatesForTransaction(
  transactionId: Types.ObjectId,
  limit = 10,
): Promise<Array<{ obligationId: string; confidence: number; signals: unknown; obligation: unknown }>> {
  const transaction = await BankTransaction.findById(transactionId).lean();
  if (!transaction) throw ApiError.notFound('Bank transaction');

  // Widen the amount window for manual review: finance may be reconciling a
  // debit that was netted or partially paid.
  const candidates = await candidatesFor(
    transaction.tenantId,
    transaction.companyId,
    transaction.amount,
    0.1,
  );

  const ranked = rank(
    {
      amount: transaction.amount,
      description: transaction.description,
      reference: transaction.reference,
      utr: transaction.utr,
      transactionDate: transaction.transactionDate,
    },
    candidates,
    limit,
  );

  const obligations = await PaymentObligation.find({
    _id: { $in: ranked.map((entry) => new Types.ObjectId(entry.candidateId)) },
  }).lean();
  const byId = new Map(obligations.map((entry) => [String(entry._id), entry]));

  return ranked.map((entry) => ({
    obligationId: entry.candidateId,
    confidence: entry.confidence,
    signals: entry.signals,
    obligation: byId.get(entry.candidateId),
  }));
}

/**
 * Confirms a match — the single operation that makes a payment real.
 *
 * PRD §27: reconciliation is the strongest evidence that payment actually
 * occurred, so PAID is only ever reached from here, never from someone
 * clicking a button labelled "paid".
 *
 * Everything downstream happens in one call: the obligation and its invoice
 * or payroll batch advance, the payment batch rollup is recomputed, and the
 * vendor confirmation email is queued.
 */
export async function confirmMatch(
  input: {
    bankTransactionId: Types.ObjectId;
    obligationId: Types.ObjectId;
    confirmedBy: Types.ObjectId;
    confirmedByName: string;
    note?: string;
    method?: 'AUTO_SUGGESTED' | 'MANUAL';
  },
  context: AuditContext,
): Promise<{ reconciliationId: Types.ObjectId }> {
  const [transaction, obligation] = await Promise.all([
    BankTransaction.findById(input.bankTransactionId),
    PaymentObligation.findById(input.obligationId),
  ]);
  if (!transaction) throw ApiError.notFound('Bank transaction');
  if (!obligation) throw ApiError.notFound('Payment');

  if (!transaction.tenantId.equals(obligation.tenantId)) {
    throw ApiError.forbidden('That transaction and payment belong to different tenants');
  }
  if (transaction.direction !== 'DEBIT') {
    throw ApiError.unprocessable('Only a debit can settle a payment obligation');
  }
  if (transaction.reconciliationStatus === ReconciliationStatus.MATCHED) {
    throw ApiError.conflict('This bank transaction is already reconciled');
  }
  if (obligation.reconciliationStatus === ReconciliationStatus.MATCHED) {
    throw ApiError.conflict('This payment is already reconciled against another transaction');
  }

  // Replace any earlier suggestion for either side rather than leaving
  // stale SUGGESTED rows behind.
  await Reconciliation.deleteMany({
    status: ReconciliationStatus.SUGGESTED,
    $or: [{ bankTransactionId: transaction._id }, { obligationId: obligation._id }],
  });

  const scored = rank(
    {
      amount: transaction.amount,
      description: transaction.description,
      reference: transaction.reference,
      utr: transaction.utr,
      transactionDate: transaction.transactionDate,
    },
    [toCandidate(obligation)],
    1,
  )[0];

  const reconciliation = await Reconciliation.create({
    tenantId: transaction.tenantId,
    companyId: transaction.companyId,
    bankTransactionId: transaction._id,
    obligationId: obligation._id,
    paymentBatchId: obligation.paymentBatchId,
    status: ReconciliationStatus.MATCHED,
    confidence: scored?.confidence ?? 0,
    method: input.method ?? 'MANUAL',
    signals: scored?.signals,
    confirmedBy: input.confirmedBy,
    confirmedAt: new Date(),
    note: input.note,
  });

  transaction.reconciliationStatus = ReconciliationStatus.MATCHED;
  transaction.reconciliationId = reconciliation._id;
  await transaction.save();

  obligation.reconciliationStatus = ReconciliationStatus.MATCHED;
  obligation.paymentStatus = PaymentStatus.PAID;
  obligation.bankTransactionId = transaction._id;
  obligation.paidAt = transaction.transactionDate;
  obligation.reconciledAt = new Date();
  await obligation.save();

  await PaymentBatchItem.updateOne(
    { obligationId: obligation._id },
    { reconciliationStatus: ReconciliationStatus.MATCHED },
  );

  await audit.record(
    {
      event: 'reconciliation.confirmed',
      entityType: 'RECONCILIATION',
      entityId: reconciliation._id,
      entityLabel: `${obligation.payeeName} ${obligation.reference}`,
      tenantId: obligation.tenantId,
      companyId: obligation.companyId,
      newValue: {
        amount: obligation.amount,
        transactionDate: transaction.transactionDate,
        confidence: reconciliation.confidence,
      },
      metadata: {
        confirmedBy: input.confirmedByName,
        method: reconciliation.method,
        narration: transaction.description,
        note: input.note,
      },
    },
    context,
  );

  if (obligation.type === ObligationType.VENDOR) {
    await settleInvoice(obligation, transaction.transactionDate, context);
  } else {
    await settlePayrollEmployee(obligation, context);
  }

  if (obligation.paymentBatchId) {
    await refreshReconciliationTotals(obligation.paymentBatchId);
  }

  return { reconciliationId: reconciliation._id };
}

/** Marks a bank transaction as deliberately not reconcilable (PRD §26). */
export async function ignoreTransaction(
  transactionId: Types.ObjectId,
  note: string,
  actorId: Types.ObjectId,
  context: AuditContext,
): Promise<void> {
  const transaction = await BankTransaction.findById(transactionId);
  if (!transaction) throw ApiError.notFound('Bank transaction');
  if (transaction.reconciliationStatus === ReconciliationStatus.MATCHED) {
    throw ApiError.conflict('Unmatch this transaction before ignoring it');
  }

  await Reconciliation.deleteMany({
    bankTransactionId: transaction._id,
    status: ReconciliationStatus.SUGGESTED,
  });

  const reconciliation = await Reconciliation.create({
    tenantId: transaction.tenantId,
    companyId: transaction.companyId,
    bankTransactionId: transaction._id,
    status: ReconciliationStatus.IGNORED,
    confidence: 0,
    method: 'MANUAL',
    confirmedBy: actorId,
    confirmedAt: new Date(),
    note,
  });

  transaction.reconciliationStatus = ReconciliationStatus.IGNORED;
  transaction.reconciliationId = reconciliation._id;
  await transaction.save();

  await audit.record(
    {
      event: 'reconciliation.ignored',
      entityType: 'BANK_TRANSACTION',
      entityId: transaction._id,
      entityLabel: transaction.description,
      tenantId: transaction.tenantId,
      companyId: transaction.companyId,
      metadata: { note, amount: transaction.amount },
    },
    context,
  );
}

/**
 * Reverses a confirmed match.
 *
 * Deliberately does not walk the invoice back to unpaid: once an invoice has
 * been reported as paid, silently reverting it would hide the correction.
 * The obligation returns to the queue and the audit trail carries the reason.
 */
export async function unmatch(
  reconciliationId: Types.ObjectId,
  note: string,
  context: AuditContext,
): Promise<void> {
  const reconciliation = await Reconciliation.findById(reconciliationId);
  if (!reconciliation) throw ApiError.notFound('Reconciliation');
  if (reconciliation.status !== ReconciliationStatus.MATCHED) {
    throw ApiError.conflict('Only a confirmed match can be reversed');
  }

  await BankTransaction.updateOne(
    { _id: reconciliation.bankTransactionId },
    { reconciliationStatus: ReconciliationStatus.UNMATCHED, $unset: { reconciliationId: 1 } },
  );

  if (reconciliation.obligationId) {
    await PaymentObligation.updateOne(
      { _id: reconciliation.obligationId },
      {
        reconciliationStatus: ReconciliationStatus.UNMATCHED,
        paymentStatus: PaymentStatus.PROCESSING,
        $unset: { bankTransactionId: 1, paidAt: 1, reconciledAt: 1 },
      },
    );
    await PaymentBatchItem.updateOne(
      { obligationId: reconciliation.obligationId },
      { reconciliationStatus: ReconciliationStatus.UNMATCHED },
    );
  }

  const batchId = reconciliation.paymentBatchId;
  await Reconciliation.deleteOne({ _id: reconciliation._id });

  await audit.record(
    {
      event: 'reconciliation.reversed',
      entityType: 'RECONCILIATION',
      entityId: reconciliation._id,
      tenantId: reconciliation.tenantId,
      companyId: reconciliation.companyId,
      oldValue: { status: ReconciliationStatus.MATCHED },
      newValue: { status: ReconciliationStatus.UNMATCHED },
      metadata: { note },
    },
    context,
  );

  if (batchId) await refreshReconciliationTotals(batchId);
}

/** Moves an invoice to PAID then RECONCILED and notifies the vendor (§27, §28). */
async function settleInvoice(
  obligation: { sourceId: Types.ObjectId; tenantId: Types.ObjectId; companyId: Types.ObjectId; amount: number; reference: string },
  paidAt: Date,
  context: AuditContext,
): Promise<void> {
  const invoice = await Invoice.findById(obligation.sourceId);
  if (!invoice) return;

  const from = invoice.status;
  if (invoiceMachine.canTransition(invoice.status, InvoiceStatus.PAID)) {
    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = paidAt;
  }
  if (invoiceMachine.canTransition(invoice.status, InvoiceStatus.RECONCILED)) {
    invoice.status = InvoiceStatus.RECONCILED;
    invoice.reconciledAt = new Date();
  }
  await invoice.save();

  await audit.recordStatusChange(
    {
      event: 'invoice.paid',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: invoice.status,
      metadata: { paidAt, amount: invoice.totalAmount },
    },
    context,
  );

  // Tell the finance team the invoice is settled. Published before the vendor
  // email below, because that branch returns early when a vendor has no
  // address on file and would otherwise swallow this too.
  eventBus.publish({
    type: NotificationType.RECONCILIATION_COMPLETED,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'INVOICE',
    entityId: String(invoice._id),
    recipientUserIds: invoice.submittedBy ? [String(invoice.submittedBy)] : [],
    title: `Invoice ${invoice.invoiceNumber ?? ''} reconciled`,
    body: `${invoice.vendorName ?? 'An invoice'} for ${formatINR(invoice.totalAmount ?? 0)} was matched to the bank statement and is now paid.`,
    link: `/invoices/${String(invoice._id)}`,
  });

  // Vendor payment confirmation — PRD §28.
  const vendor = invoice.vendorId ? await Vendor.findById(invoice.vendorId).lean() : null;
  if (!vendor?.email) {
    logger.info({ invoiceId: String(invoice._id) }, 'no vendor email; skipping payment confirmation');
    return;
  }

  eventBus.publish({
    type: NotificationType.VENDOR_PAYMENT_COMPLETED,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'INVOICE',
    entityId: String(invoice._id),
    recipientEmail: vendor.email,
    title: `Payment confirmation — invoice ${invoice.invoiceNumber ?? ''}`,
    body: [
      `Dear ${vendor.name},`,
      '',
      `We have paid your invoice ${invoice.invoiceNumber ?? ''} for ${formatINR(invoice.totalAmount ?? 0)}.`,
      `Payment date: ${paidAt.toISOString().slice(0, 10)}`,
      obligation.reference ? `Payment reference: ${obligation.reference}` : '',
      '',
      'This is an automated confirmation from our accounts payable system.',
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.totalAmount,
      paymentDate: paidAt.toISOString(),
      reference: obligation.reference,
    },
  });
}

/** Rolls a payroll batch to PAID once every employee obligation is reconciled. */
async function settlePayrollEmployee(
  obligation: { sourceBatchId?: Types.ObjectId; tenantId: Types.ObjectId; companyId: Types.ObjectId },
  context: AuditContext,
): Promise<void> {
  if (!obligation.sourceBatchId) return;

  const [total, reconciled] = await Promise.all([
    PaymentObligation.countDocuments({ sourceBatchId: obligation.sourceBatchId }),
    PaymentObligation.countDocuments({
      sourceBatchId: obligation.sourceBatchId,
      reconciliationStatus: ReconciliationStatus.MATCHED,
    }),
  ]);
  if (total === 0 || reconciled < total) return;

  const batch = await PayrollBatch.findById(obligation.sourceBatchId);
  if (!batch) return;

  const from = batch.status;
  for (const next of [PayrollBatchStatus.PAID, PayrollBatchStatus.RECONCILED]) {
    if (payrollBatchMachine.canTransition(batch.status, next)) batch.status = next;
  }
  batch.paidAt = new Date();
  await batch.save();

  await audit.recordStatusChange(
    {
      event: 'payroll.paid',
      entityType: 'PAYROLL_BATCH',
      entityId: batch._id,
      entityLabel: batch.label,
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      from,
      to: batch.status,
      metadata: { employeeCount: total, totalNetAmount: batch.totalNetAmount },
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.RECONCILIATION_COMPLETED,
    tenantId: String(batch.tenantId),
    companyId: String(batch.companyId),
    entityType: 'PAYROLL_BATCH',
    entityId: String(batch._id),
    recipientUserIds: [batch.importedBy, batch.submittedBy].filter(Boolean).map(String),
    title: `${batch.label} fully reconciled`,
    body: `All ${total} salary payments totalling ${formatINR(batch.totalNetAmount)} have been matched to the bank statement.`,
    link: `/payroll/${String(batch._id)}`,
  });
}

/**
 * Obligations that could plausibly be settled by a debit of this amount.
 *
 * Filtering by amount in the query keeps the candidate set small even for a
 * company with thousands of open payments; the scorer then does the rest.
 */
async function candidatesFor(
  tenantId: Types.ObjectId,
  companyId: Types.ObjectId,
  amount: number,
  tolerance = 0.005,
): Promise<MatchCandidate[]> {
  const window = Math.max(100, Math.round(amount * tolerance));

  const obligations = await PaymentObligation.find({
    tenantId,
    companyId,
    paymentStatus: { $in: [PaymentStatus.PROCESSING, PaymentStatus.BATCHED] },
    reconciliationStatus: { $ne: ReconciliationStatus.MATCHED },
    amount: { $gte: amount - window, $lte: amount + window },
  })
    .limit(200)
    .lean();

  const batchIds = [...new Set(obligations.map((entry) => entry.paymentBatchId).filter(Boolean))];
  const batches = await PaymentBatch.find({ _id: { $in: batchIds } })
    .select('_id exportedAt paymentDate')
    .lean();
  const batchById = new Map(batches.map((batch) => [String(batch._id), batch]));

  return obligations.map((obligation) => {
    const batch = obligation.paymentBatchId ? batchById.get(String(obligation.paymentBatchId)) : undefined;
    return {
      id: String(obligation._id),
      amount: obligation.amount,
      beneficiaryName: obligation.beneficiaryName,
      payeeName: obligation.payeeName,
      reference: obligation.reference,
      paymentBatchReference: obligation.paymentBatchReference,
      expectedDate: batch?.exportedAt ?? batch?.paymentDate ?? obligation.dueDate,
    };
  });
}

function toCandidate(obligation: {
  _id: Types.ObjectId;
  amount: number;
  beneficiaryName: string;
  payeeName: string;
  reference: string;
  paymentBatchReference?: string;
  dueDate?: Date;
}): MatchCandidate {
  return {
    id: String(obligation._id),
    amount: obligation.amount,
    beneficiaryName: obligation.beneficiaryName,
    payeeName: obligation.payeeName,
    reference: obligation.reference,
    paymentBatchReference: obligation.paymentBatchReference,
    expectedDate: obligation.dueDate,
  };
}

/**
 * Who needs to know about unmatched bank lines: whoever uploaded the
 * statement, plus everyone who can actually act on it.
 */
async function reconcilerUserIds(
  tenantId: Types.ObjectId,
  companyId: Types.ObjectId,
  statementId: Types.ObjectId,
): Promise<string[]> {
  const statement = await BankStatement.findById(statementId).select('uploadedBy').lean();

  const reconcilers = await User.find({
    tenantId,
    status: 'ACTIVE',
    roleKeys: { $in: RECONCILING_ROLES },
    $or: [{ companyIds: companyId }, { companyIds: { $size: 0 } }],
  })
    .select('_id')
    .lean();

  return [
    ...new Set([
      ...(statement?.uploadedBy ? [String(statement.uploadedBy)] : []),
      ...reconcilers.map((user) => String(user._id)),
    ]),
  ];
}

/** Roles whose permission set includes reconciliation:confirm. */
const RECONCILING_ROLES = ROLE_KEYS.filter((role) =>
  ROLE_PERMISSIONS[role as RoleKey].includes('reconciliation:confirm'),
);
