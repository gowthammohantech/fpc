import { Types } from 'mongoose';
import {
  ApprovalStatus,
  MatchMethod,
  PayrollBatchStatus,
  ReconciliationStatus,
  ValidationCode,
  ValidationSeverity,
  type ValidationFinding,
} from '@fpc/shared';
import { logger } from '../config/logger.js';
import { BankStatement, BankTransaction, Reconciliation } from '../models/banking.model.js';
import { PaymentBatchItem } from '../models/paymentBatch.model.js';
import { PaymentObligation } from '../models/paymentObligation.model.js';
import { PayrollBatch, PayrollEmployee } from '../models/payroll.model.js';
import { act } from '../modules/approvals/approval.service.js';
import { onApprovalDecided } from '../modules/approvals/approval.dispatcher.js';
import { createBatch, exportBatch } from '../modules/payments/paymentBatch.service.js';
import { confirmMatch } from '../modules/reconciliation/reconciliation.service.js';
import { submitForApproval } from '../modules/payroll/payroll.service.js';
import {
  PAYROLL,
  PAYROLL_BAD_ROWS,
  PAYROLL_PREVIOUS,
  PAYROLL_TECHNOLOGIES,
  PAYROLL_TECHNOLOGIES_REVIEW,
  type PayrollSpec,
} from './data.payroll.js';
import { buildPayrollEmployees, type PayrollRow } from './payrollRows.js';
import { buildPayrollWorkbook } from './fixtures.js';
import { storeDocument } from './documents.seed.js';
import { actor, endOfMonth, monthsAgo, user, type SeedContext } from './context.js';

const IMPORTER: Record<string, string> = {
  engineering: 'payroll@nova.example.com',
  technologies: 'techpayroll@nova.example.com',
};
const CFO = 'cfo@nova.example.com';
const BATCH_MAKER = 'ravi@nova.example.com';
const BATCH_CHECKER = 'financemanager@nova.example.com';

export interface PayrollSeedResult {
  batches: number;
  employees: number;
}

/**
 * Four payroll runs, each resting somewhere different.
 *
 * The current Nova Engineering run is the flagship demo and is deliberately
 * left awaiting approval. The one before it is carried all the way to
 * reconciled, which is what gives the CFO a real month-on-month figure instead
 * of a hard-coded one, and what puts payroll obligations in the pipeline.
 */
export async function seedPayroll(
  context: SeedContext,
  options: { history: boolean },
): Promise<PayrollSeedResult> {
  const result: PayrollSeedResult = { batches: 0, employees: 0 };

  // The settled run first: this month's batch points back at it.
  const previous = options.history
    ? await seedSettledPayrollRun(context, PAYROLL_PREVIOUS, result)
    : null;

  await seedBatch(context, PAYROLL, result, {
    status: PayrollBatchStatus.VALIDATED,
    approvalStatus: ApprovalStatus.PENDING,
    previous,
  });

  const technologies = await seedBatch(context, PAYROLL_TECHNOLOGIES, result, {
    status: PayrollBatchStatus.VALIDATED,
    approvalStatus: ApprovalStatus.PENDING,
    previous: null,
  });
  if (technologies) await approveAndFanOut(context, PAYROLL_TECHNOLOGIES, technologies);

  await seedBatch(context, PAYROLL_TECHNOLOGIES_REVIEW, result, {
    status: PayrollBatchStatus.REVIEW_REQUIRED,
    approvalStatus: ApprovalStatus.NOT_REQUIRED,
    previous: technologies,
    badRows: true,
  });

  return result;
}

/** Creates a batch and its employee register, if that period has none yet. */
async function seedBatch(
  context: SeedContext,
  spec: PayrollSpec,
  result: PayrollSeedResult,
  options: {
    status: PayrollBatchStatus;
    approvalStatus: ApprovalStatus;
    previous: Types.ObjectId | null;
    badRows?: boolean;
  },
): Promise<Types.ObjectId | null> {
  const tenantId = context.tenantId;
  const companyId = context.companyIds[spec.company]!;
  const period = monthsAgo(spec.monthsAgo);

  const existing = await PayrollBatch.findOne({
    tenantId,
    companyId,
    periodMonth: period.month,
    periodYear: period.year,
  })
    .select('_id')
    .lean();
  if (existing) return existing._id;

  const rows = buildPayrollEmployees(spec);
  const findings: ValidationFinding[] = [];
  const rowFindings = new Map<number, ValidationFinding[]>();

  if (options.badRows) applyBadRows(rows, rowFindings, findings);

  const total = rows.reduce((sum, row) => sum + row.netAmount, 0);
  const importer = user(context, IMPORTER[spec.company]!);
  const previousBatch = options.previous
    ? await PayrollBatch.findById(options.previous).select('totalNetAmount').lean()
    : null;

  const sourceFileName = `${period.name}-${period.year}-Payroll.xlsx`;
  const stored = await storeDocument({
    tenantId,
    companyId,
    key: `payroll/${String(companyId)}/${period.year}-${String(period.month).padStart(2, '0')}-${sourceFileName}`,
    fileName: sourceFileName,
    body: await buildPayrollWorkbook(rows, spec.company),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploadedBy: importer.id,
    kind: 'PAYROLL_IMPORT',
  });

  const batch = await PayrollBatch.create({
    tenantId,
    companyId,
    reference: `PR-${period.year}${String(period.month).padStart(2, '0')}`,
    periodMonth: period.month,
    periodYear: period.year,
    label: `${period.name} ${period.year} Payroll`,
    status: options.status,
    employeeCount: rows.length,
    totalNetAmount: total,
    currency: 'INR',
    locationBreakdown: spec.locations.map((location) => ({
      locationId: context.locationIds[location.key],
      locationName: location.name,
      count: rows.filter((row) => row.locationKey === location.key).length,
      amount: rows
        .filter((row) => row.locationKey === location.key)
        .reduce((sum, row) => sum + row.netAmount, 0),
    })),
    previousBatchId: options.previous ?? undefined,
    previousTotalNetAmount: previousBatch?.totalNetAmount,
    sourceFileId: stored.fileId,
    sourceFileName,
    findings,
    approvalStatus: options.approvalStatus,
    importedBy: importer.id,
  });

  await PayrollEmployee.insertMany(
    rows.map((row, index) => ({
      tenantId,
      companyId,
      payrollBatchId: batch._id,
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      bankAccountNumber: row.bankAccountNumber,
      ifsc: row.ifsc,
      netAmount: row.netAmount,
      departmentName: row.departmentName,
      locationName: row.locationName,
      locationId: context.locationIds[row.locationKey],
      rowNumber: index + 5,
      findings: rowFindings.get(index) ?? [],
    })),
  );

  result.batches += 1;
  result.employees += rows.length;
  return batch._id;
}

/**
 * Rows the importer would refuse, so the review screen has real errors to
 * show and the batch is genuinely blocked from approval.
 */
function applyBadRows(
  rows: PayrollRow[],
  rowFindings: Map<number, ValidationFinding[]>,
  findings: ValidationFinding[],
): void {
  for (const bad of PAYROLL_BAD_ROWS) {
    const row = rows[bad.index];
    if (!row) continue;
    if (bad.bankAccountNumber) row.bankAccountNumber = bad.bankAccountNumber;
    if (bad.ifsc) row.ifsc = bad.ifsc;
    if (bad.netAmount !== undefined) row.netAmount = bad.netAmount;

    rowFindings.set(bad.index, [
      {
        code:
          bad.field === 'netAmount'
            ? ValidationCode.NEGATIVE_AMOUNT
            : ValidationCode.MISSING_VENDOR_BANK_DETAILS,
        severity: ValidationSeverity.ERROR,
        message: bad.message,
        field: bad.field,
        resolved: false,
      },
    ]);
  }

  findings.push({
    code: ValidationCode.MISSING_VENDOR_BANK_DETAILS,
    severity: ValidationSeverity.ERROR,
    message: `${PAYROLL_BAD_ROWS.length} employee rows have errors that must be fixed before approval`,
    resolved: false,
  });
}

/** Submits a batch, has the CFO approve it, and fans it out to obligations. */
async function approveAndFanOut(
  context: SeedContext,
  spec: PayrollSpec,
  batchId: Types.ObjectId,
): Promise<boolean> {
  const batch = await PayrollBatch.findById(batchId).select('status').lean();
  if (!batch || batch.status !== PayrollBatchStatus.VALIDATED) return false;

  const importerEmail = IMPORTER[spec.company]!;
  const importer = user(context, importerEmail);
  const cfo = user(context, CFO);

  const { approvalRequestId } = await submitForApproval(
    batchId,
    importer.id,
    actor(context, importerEmail),
  );
  if (!approvalRequestId) return true; // auto-approved; the service fanned it out

  const decision = await act(
    {
      requestId: approvalRequestId,
      actorUserId: cfo.id,
      actorName: cfo.name,
      action: 'APPROVE',
    },
    actor(context, CFO),
  );
  await onApprovalDecided(decision, actor(context, CFO));
  return true;
}

/**
 * Last month's payroll, carried all the way through: approved, fanned out,
 * paid by bank file and reconciled against a statement.
 *
 * PAID is reached the only way the product allows — by confirming a match.
 * The bulk of the settlement is written directly because `confirmMatch` costs
 * around a dozen round trips per call and this batch has hundreds of rows; the
 * final employee goes through the real service, and it is that call which sees
 * the batch fully reconciled and rolls it to PAID and then RECONCILED.
 */
async function seedSettledPayrollRun(
  context: SeedContext,
  spec: PayrollSpec,
  result: PayrollSeedResult,
): Promise<Types.ObjectId | null> {
  const batchId = await seedBatch(context, spec, result, {
    status: PayrollBatchStatus.VALIDATED,
    approvalStatus: ApprovalStatus.PENDING,
    previous: null,
  });
  if (!batchId) return null;

  const current = await PayrollBatch.findById(batchId).select('status reference').lean();
  if (current?.status !== PayrollBatchStatus.VALIDATED) return batchId;

  await approveAndFanOut(context, spec, batchId);

  const tenantId = context.tenantId;
  const companyId = context.companyIds[spec.company]!;
  const period = monthsAgo(spec.monthsAgo);
  const paymentDate = endOfMonth(period);

  const obligations = await PaymentObligation.find({ sourceBatchId: batchId })
    .select('_id amount beneficiaryName reference')
    .lean();
  if (!obligations.length) {
    logger.warn('seed: payroll fan-out produced no obligations; leaving the run unpaid');
    return batchId;
  }

  const maker = user(context, BATCH_MAKER);
  const checker = user(context, BATCH_CHECKER);

  const paymentBatch = await createBatch(
    {
      tenantId,
      companyId,
      paymentDate,
      bankAccountId: context.bankAccountIds[`${spec.company}:payroll`],
      obligationIds: obligations.map((entry) => entry._id),
      createdBy: maker.id,
    },
    actor(context, BATCH_MAKER),
  );

  await exportBatch(
    paymentBatch._id,
    { userId: checker.id, name: checker.name },
    actor(context, BATCH_CHECKER),
  );

  // The bank debits land the day after the file goes out.
  const valueDate = new Date(paymentDate.getTime() + 86_400_000);
  const statement = await BankStatement.create({
    tenantId,
    companyId,
    bankAccountId: context.bankAccountIds[`${spec.company}:payroll`],
    fileName: `Payroll_Statement_${period.year}${String(period.month).padStart(2, '0')}.xlsx`,
    status: 'PARSED',
    periodStart: paymentDate,
    periodEnd: valueDate,
    transactionCount: obligations.length,
    duplicateCount: 0,
    totalDebit: obligations.reduce((sum, entry) => sum + entry.amount, 0),
    totalCredit: 0,
    uploadedBy: maker.id,
  });

  const transactions = await BankTransaction.insertMany(
    obligations.map((obligation) => ({
      tenantId,
      companyId,
      bankAccountId: context.bankAccountIds[`${spec.company}:payroll`],
      bankStatementId: statement._id,
      transactionDate: valueDate,
      description: `NEFT SALARY ${obligation.beneficiaryName.toUpperCase()}`,
      reference: paymentBatch.reference,
      direction: 'DEBIT' as const,
      amount: obligation.amount,
      reconciliationStatus: ReconciliationStatus.UNMATCHED,
      dedupeHash: `seed-payroll-${String(obligation._id)}`,
    })),
  );

  // Everything but the last row, in bulk.
  const bulk = obligations.slice(0, -1);
  if (bulk.length) {
    const reconciliations = await Reconciliation.insertMany(
      bulk.map((obligation, index) => ({
        tenantId,
        companyId,
        bankTransactionId: transactions[index]!._id,
        obligationId: obligation._id,
        paymentBatchId: paymentBatch._id,
        status: ReconciliationStatus.MATCHED,
        confidence: 99,
        method: MatchMethod.AUTO_SUGGESTED,
        confirmedBy: maker.id,
        confirmedAt: valueDate,
      })),
    );

    await PaymentObligation.bulkWrite(
      bulk.map((obligation, index) => ({
        updateOne: {
          filter: { _id: obligation._id },
          update: {
            $set: {
              paymentStatus: 'PAID',
              reconciliationStatus: ReconciliationStatus.MATCHED,
              bankTransactionId: transactions[index]!._id,
              paidAt: valueDate,
              reconciledAt: valueDate,
            },
          },
        },
      })),
    );

    await BankTransaction.bulkWrite(
      bulk.map((_, index) => ({
        updateOne: {
          filter: { _id: transactions[index]!._id },
          update: {
            $set: {
              reconciliationStatus: ReconciliationStatus.MATCHED,
              reconciliationId: reconciliations[index]!._id,
            },
          },
        },
      })),
    );

    await PaymentBatchItem.updateMany(
      { obligationId: { $in: bulk.map((entry) => entry._id) } },
      { reconciliationStatus: ReconciliationStatus.MATCHED },
    );
  }

  // The last one through the real service, which is what rolls the payroll
  // batch to PAID and then RECONCILED once it sees every row matched.
  const last = obligations[obligations.length - 1]!;
  await confirmMatch(
    {
      bankTransactionId: transactions[transactions.length - 1]!._id,
      obligationId: last._id,
      confirmedBy: maker.id,
      confirmedByName: maker.name,
      method: MatchMethod.AUTO_SUGGESTED,
    },
    actor(context, BATCH_MAKER),
  );

  return batchId;
}
