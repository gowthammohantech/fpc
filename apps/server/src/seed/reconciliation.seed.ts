import { Types } from 'mongoose';
import { ReconciliationStatus, toMinor } from '@fpc/shared';
import { logger } from '../config/logger.js';
import { BankStatement, BankTransaction } from '../models/banking.model.js';
import { PaymentBatch } from '../models/paymentBatch.model.js';
import {
  confirmMatch,
  ignoreTransaction,
  suggestMatchesForStatement,
} from '../modules/reconciliation/reconciliation.service.js';
import { actor, daysFromNow, user, type SeedContext } from './context.js';

const RECONCILER = 'ravi@nova.example.com';
const STATEMENT_FILE = 'HDFC_Statement_seed_02.xlsx';

/**
 * A statement that leaves one row in each reconciliation state.
 *
 * The workspace has four tabs and, before this, only Matched had anything in
 * it. Suggestions are produced by the real matcher rather than written
 * directly, so the confidence and per-signal breakdown on screen are the
 * engine's own numbers.
 */
export async function seedReconciliation(
  context: SeedContext,
  partialBatchId: Types.ObjectId | undefined,
): Promise<number> {
  const tenantId = context.tenantId;
  const companyId = context.companyIds.engineering!;
  const bankAccountId = context.bankAccountIds['engineering:ops']!;

  if (await BankStatement.exists({ tenantId, companyId, fileName: STATEMENT_FILE })) return 0;
  if (!partialBatchId) return 0;

  const batch = await PaymentBatch.findById(partialBatchId).select('reference').lean();
  const reference = batch?.reference ?? '';
  const uploader = user(context, RECONCILER);
  const uploaderContext = actor(context, RECONCILER);

  // One day after the file went to the bank, which is when a real debit lands.
  const transactionDate = daysFromNow(-5);

  const rows = [
    {
      description: 'NEFT ABC INDUSTRIAL SUPPLIES LTD',
      reference,
      direction: 'DEBIT' as const,
      amount: toMinor(11_50_000),
    },
    {
      description: 'NEFT ZENITH METALS LTD',
      reference,
      direction: 'DEBIT' as const,
      amount: toMinor(8_50_000),
    },
    {
      // Nothing in the queue is anywhere near this figure, so the matcher
      // declines rather than guessing.
      description: 'NEFT UNKNOWN BENEFICIARY 4417',
      reference: 'N4417220931',
      direction: 'DEBIT' as const,
      amount: toMinor(3_10_000),
    },
    {
      description: 'BANK CHARGES NEFT OUTWARD',
      reference: 'CHG1180',
      direction: 'DEBIT' as const,
      amount: toMinor(1_180),
    },
    {
      // A receipt, not a payment. Reconciliation only ever looks at debits.
      description: 'CUSTOMER RECEIPT ORION SYSTEMS',
      reference: 'C2026091122',
      direction: 'CREDIT' as const,
      amount: toMinor(22_00_000),
    },
  ];

  const totalDebit = rows
    .filter((row) => row.direction === 'DEBIT')
    .reduce((sum, row) => sum + row.amount, 0);
  const totalCredit = rows
    .filter((row) => row.direction === 'CREDIT')
    .reduce((sum, row) => sum + row.amount, 0);

  const statement = await BankStatement.create({
    tenantId,
    companyId,
    bankAccountId,
    fileName: STATEMENT_FILE,
    status: 'PARSED',
    periodStart: daysFromNow(-7),
    periodEnd: daysFromNow(-5),
    transactionCount: rows.length,
    duplicateCount: 0,
    totalDebit,
    totalCredit,
    uploadedBy: uploader.id,
  });

  const transactions = await BankTransaction.insertMany(
    rows.map((row, index) => ({
      tenantId,
      companyId,
      bankAccountId,
      bankStatementId: statement._id,
      transactionDate,
      description: row.description,
      reference: row.reference,
      direction: row.direction,
      amount: row.amount,
      reconciliationStatus: ReconciliationStatus.UNMATCHED,
      // A seed-prefixed hash cannot collide with one the importer computes, so
      // re-uploading a real statement still imports every row.
      dedupeHash: `seed-stmt02-${index}`,
    })),
  );

  const { suggested } = await suggestMatchesForStatement(statement._id, uploaderContext);
  logger.debug({ suggested }, 'seed: suggestions generated for the seeded statement');

  // Confirm the first suggestion and leave the second for the demo, so both
  // Matched and Suggested have a row.
  const abc = transactions[0]!;
  const suggestion = await BankTransaction.findById(abc._id).lean();
  if (suggestion?.reconciliationStatus === ReconciliationStatus.SUGGESTED) {
    const match = await matchedObligationFor(abc._id);
    if (match) {
      await confirmMatch(
        {
          bankTransactionId: abc._id,
          obligationId: match,
          confirmedBy: uploader.id,
          confirmedByName: uploader.name,
          method: 'AUTO_SUGGESTED',
        },
        uploaderContext,
      );
    }
  }

  await ignoreTransaction(
    transactions[3]!._id,
    'Bank charge, not a payment we owe',
    uploader.id,
    uploaderContext,
  );

  return rows.length;
}

async function matchedObligationFor(
  bankTransactionId: Types.ObjectId,
): Promise<Types.ObjectId | null> {
  const { Reconciliation } = await import('../models/banking.model.js');
  const suggestion = await Reconciliation.findOne({
    bankTransactionId,
    status: ReconciliationStatus.SUGGESTED,
  })
    .select('obligationId')
    .lean();
  return suggestion?.obligationId ?? null;
}
