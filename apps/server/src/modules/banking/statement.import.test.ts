import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import { dedupeHash, parseStatement } from './statement.import.js';

async function workbookOf(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const ACCOUNT = 'acct-1';

describe('bank statement import', () => {
  it('reads separate debit and credit columns', async () => {
    const buffer = await workbookOf([
      ['Transaction Date', 'Narration', 'Reference', 'Withdrawal', 'Deposit', 'Closing Balance'],
      ['05/09/2026', 'NEFT TECHZONE SOLUTIONS', 'N123', 3_540_000, '', 55_000_000],
      ['05/09/2026', 'CUSTOMER RECEIPT', 'C1', '', 1_000_000, 56_000_000],
    ]);

    const result = await parseStatement(buffer, 'statement.xlsx', ACCOUNT);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      direction: 'DEBIT',
      amount: toMinor(3_540_000),
      description: 'NEFT TECHZONE SOLUTIONS',
    });
    expect(result.transactions[1]!.direction).toBe('CREDIT');
    expect(result.totalDebit).toBe(toMinor(3_540_000));
    expect(result.totalCredit).toBe(toMinor(1_000_000));
    expect(result.closingBalance).toBe(toMinor(56_000_000));
  });

  it('reads a single signed amount column', async () => {
    const buffer = await workbookOf([
      ['Date', 'Description', 'Amount'],
      ['2026-09-05', 'NEFT TECHZONE', -3_540_000],
      ['2026-09-06', 'REFUND', 2_000],
    ]);

    const result = await parseStatement(buffer, 'statement.xlsx', ACCOUNT);
    expect(result.transactions.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(result.transactions[0]!.amount).toBe(toMinor(3_540_000));
  });

  it('reads dates day-first, as Indian bank exports write them', async () => {
    const buffer = await workbookOf([
      ['Txn Date', 'Narration', 'Debit'],
      ['05/09/2026', 'NEFT', 1000],
    ]);
    const result = await parseStatement(buffer, 'statement.xlsx', ACCOUNT);
    // 5 September, not 9 May.
    expect(result.transactions[0]!.transactionDate.getUTCMonth()).toBe(8);
    expect(result.transactions[0]!.transactionDate.getUTCDate()).toBe(5);
  });

  it('converts Excel serial dates', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Statement');
    sheet.addRow(['Transaction Date', 'Narration', 'Debit']);
    sheet.addRow([new Date(Date.UTC(2026, 8, 5)), 'NEFT', 1000]);
    const result = await parseStatement(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'statement.xlsx',
      ACCOUNT,
    );
    expect(result.transactions[0]!.transactionDate.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('skips summary rows with no amount rather than importing zero-value lines', async () => {
    const buffer = await workbookOf([
      ['Transaction Date', 'Narration', 'Debit', 'Credit'],
      ['05/09/2026', 'NEFT', 1000, ''],
      ['', 'STATEMENT TOTAL', '', ''],
      ['06/09/2026', 'OPENING BALANCE', 0, 0],
    ]);
    const result = await parseStatement(buffer, 'statement.xlsx', ACCOUNT);
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toHaveLength(2);
  });

  it('derives the statement period from the rows', async () => {
    const buffer = await workbookOf([
      ['Transaction Date', 'Narration', 'Debit'],
      ['06/09/2026', 'B', 1000],
      ['01/09/2026', 'A', 1000],
    ]);
    const result = await parseStatement(buffer, 'statement.xlsx', ACCOUNT);
    expect(result.periodStart?.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(result.periodEnd?.toISOString().slice(0, 10)).toBe('2026-09-06');
  });

  it('refuses a file with no recognisable date column', async () => {
    const buffer = await workbookOf([
      ['Foo', 'Bar'],
      ['a', 'b'],
    ]);
    await expect(parseStatement(buffer, 'statement.xlsx', ACCOUNT)).rejects.toThrow(
      /transaction date/i,
    );
  });

  it('refuses a file with no amount columns', async () => {
    const buffer = await workbookOf([
      ['Transaction Date', 'Narration'],
      ['05/09/2026', 'x'],
    ]);
    await expect(parseStatement(buffer, 'statement.xlsx', ACCOUNT)).rejects.toThrow(
      /debit\/credit or amount/i,
    );
  });

  it('reads CSV statements', async () => {
    const csv = 'Date,Description,Debit,Credit\n05/09/2026,NEFT TECHZONE,3540000,\n';
    const result = await parseStatement(Buffer.from(csv), 'statement.csv', ACCOUNT);
    expect(result.transactions[0]!.amount).toBe(toMinor(3_540_000));
  });
});

describe('transaction dedupe hash', () => {
  const base = {
    bankAccountId: ACCOUNT,
    transactionDate: new Date(Date.UTC(2026, 8, 5)),
    amount: toMinor(3_540_000),
    direction: 'DEBIT',
    description: 'NEFT TECHZONE SOLUTIONS',
    reference: 'N123',
  };

  it('is stable across whitespace and casing, so a re-upload is a no-op', () => {
    expect(dedupeHash(base)).toBe(
      dedupeHash({ ...base, description: '  neft   techzone   solutions ' }),
    );
  });

  it('differs when the amount, date or account differs', () => {
    expect(dedupeHash({ ...base, amount: base.amount + 1 })).not.toBe(dedupeHash(base));
    expect(dedupeHash({ ...base, transactionDate: new Date(Date.UTC(2026, 8, 6)) })).not.toBe(
      dedupeHash(base),
    );
    expect(dedupeHash({ ...base, bankAccountId: 'other' })).not.toBe(dedupeHash(base));
  });

  it('distinguishes two same-amount payments with different references', () => {
    expect(dedupeHash({ ...base, reference: 'N124' })).not.toBe(dedupeHash(base));
  });

  it('produces identical hashes for a genuinely identical re-import', async () => {
    const csv = 'Date,Description,Debit\n05/09/2026,NEFT TECHZONE,3540000\n';
    const first = await parseStatement(Buffer.from(csv), 's.csv', ACCOUNT);
    const second = await parseStatement(Buffer.from(csv), 's.csv', ACCOUNT);
    expect(first.transactions[0]!.dedupeHash).toBe(second.transactions[0]!.dedupeHash);
  });
});
