import { createHash } from 'node:crypto';
import { parseAmountToMinor } from '@fpc/shared';
import { autoDetectColumns, readTable } from '../payroll/spreadsheet.js';
import { parseInvoiceDate } from '../invoices/invoice.service.js';

/**
 * Bank statement import — PRD §24.
 *
 * Statements arrive as whatever the bank's portal exports, so this normalises
 * them into a single transaction shape. Two column conventions are supported:
 * separate debit/credit columns (most Indian banks) and a single signed
 * amount column.
 */

export type StatementField =
  | 'transactionDate'
  | 'valueDate'
  | 'description'
  | 'reference'
  | 'utr'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance';

const COLUMN_ALIASES: Record<StatementField, string[]> = {
  transactionDate: ['transaction date', 'txn date', 'date', 'posting date', 'tran date'],
  valueDate: ['value date', 'value dt'],
  description: [
    'description',
    'narration',
    'particulars',
    'transaction remarks',
    'remarks',
    'details',
  ],
  reference: ['reference', 'ref no', 'cheque no', 'chq no', 'reference number', 'transaction id'],
  utr: ['utr', 'utr number', 'rrn', 'transaction reference'],
  debit: ['debit', 'withdrawal', 'withdrawal amt', 'dr', 'debit amount', 'paid out'],
  credit: ['credit', 'deposit', 'deposit amt', 'cr', 'credit amount', 'paid in'],
  amount: ['amount', 'transaction amount'],
  balance: ['balance', 'closing balance', 'running balance', 'available balance'],
};

export interface NormalizedTransaction {
  transactionDate: Date;
  valueDate?: Date;
  description: string;
  reference?: string;
  utr?: string;
  direction: 'DEBIT' | 'CREDIT';
  /** Minor units, always positive. */
  amount: number;
  balance?: number;
  dedupeHash: string;
  rowNumber: number;
}

export interface StatementParseResult {
  headers: string[];
  mapping: Partial<Record<StatementField, string>>;
  transactions: NormalizedTransaction[];
  skipped: Array<{ rowNumber: number; reason: string }>;
  periodStart?: Date;
  periodEnd?: Date;
  /** Minor units. */
  totalDebit: number;
  totalCredit: number;
  closingBalance?: number;
}

export async function parseStatement(
  content: Buffer,
  fileName: string,
  bankAccountId: string,
  overrides?: Partial<Record<StatementField, string>>,
): Promise<StatementParseResult> {
  const table = await readTable(content, fileName);
  const mapping = {
    ...autoDetectColumns<StatementField>(table.headers, COLUMN_ALIASES),
    ...overrides,
  };

  if (!mapping.transactionDate) {
    throw new Error('Could not find a transaction date column in this statement');
  }
  if (!mapping.debit && !mapping.credit && !mapping.amount) {
    throw new Error('Could not find debit/credit or amount columns in this statement');
  }

  const transactions: NormalizedTransaction[] = [];
  const skipped: Array<{ rowNumber: number; reason: string }> = [];

  table.rows.forEach((record, index) => {
    const rowNumber = table.rowNumbers[index] ?? index + 1;

    const transactionDate = toDate(record[mapping.transactionDate!]);
    if (!transactionDate) {
      skipped.push({ rowNumber, reason: 'No readable transaction date' });
      return;
    }

    const debit = mapping.debit ? parseAmountToMinor(record[mapping.debit]) : null;
    const credit = mapping.credit ? parseAmountToMinor(record[mapping.credit]) : null;
    const signed = mapping.amount ? parseAmountToMinor(record[mapping.amount]) : null;

    let direction: 'DEBIT' | 'CREDIT';
    let amount: number;

    if (debit && debit !== 0) {
      direction = 'DEBIT';
      amount = Math.abs(debit);
    } else if (credit && credit !== 0) {
      direction = 'CREDIT';
      amount = Math.abs(credit);
    } else if (signed !== null && signed !== 0) {
      // A single signed column: negative is money leaving the account.
      direction = signed < 0 ? 'DEBIT' : 'CREDIT';
      amount = Math.abs(signed);
    } else {
      // Zero-value rows are usually the statement's own summary lines.
      skipped.push({ rowNumber, reason: 'No debit or credit amount on this row' });
      return;
    }

    const description =
      String(record[mapping.description ?? ''] ?? '').trim() || 'Bank transaction';
    const reference = mapping.reference
      ? String(record[mapping.reference] ?? '').trim()
      : undefined;
    const utr = mapping.utr ? String(record[mapping.utr] ?? '').trim() : undefined;

    transactions.push({
      transactionDate,
      valueDate: mapping.valueDate ? (toDate(record[mapping.valueDate]) ?? undefined) : undefined,
      description,
      reference: reference || undefined,
      utr: utr || undefined,
      direction,
      amount,
      balance: mapping.balance
        ? (parseAmountToMinor(record[mapping.balance]) ?? undefined)
        : undefined,
      dedupeHash: dedupeHash({
        bankAccountId,
        transactionDate,
        amount,
        direction,
        description,
        reference,
      }),
      rowNumber,
    });
  });

  const dates = transactions.map((entry) => entry.transactionDate.getTime());
  const debits = transactions.filter((entry) => entry.direction === 'DEBIT');
  const credits = transactions.filter((entry) => entry.direction === 'CREDIT');

  return {
    headers: table.headers,
    mapping,
    transactions,
    skipped,
    periodStart: dates.length ? new Date(Math.min(...dates)) : undefined,
    periodEnd: dates.length ? new Date(Math.max(...dates)) : undefined,
    totalDebit: debits.reduce((sum, entry) => sum + entry.amount, 0),
    totalCredit: credits.reduce((sum, entry) => sum + entry.amount, 0),
    closingBalance: transactions.at(-1)?.balance,
  };
}

/**
 * Identity of a statement row.
 *
 * Uploading an overlapping statement is routine — a weekly export includes
 * days already imported — so rows are identified by their content rather than
 * by position in the file, and re-importing is a no-op.
 */
export function dedupeHash(input: {
  bankAccountId: string;
  transactionDate: Date;
  amount: number;
  direction: string;
  description: string;
  reference?: string | undefined;
}): string {
  const parts = [
    input.bankAccountId,
    input.transactionDate.toISOString().slice(0, 10),
    String(input.amount),
    input.direction,
    input.description.replace(/\s+/g, ' ').trim().toLowerCase(),
    (input.reference ?? '').trim().toLowerCase(),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30.
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  return parseInvoiceDate(text);
}

export { COLUMN_ALIASES as STATEMENT_COLUMN_ALIASES };
