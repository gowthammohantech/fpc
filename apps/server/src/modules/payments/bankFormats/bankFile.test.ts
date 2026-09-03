import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import { generateBankFile, transactionTypeFor, type BankFileRow } from './index.js';

const paymentDate = new Date(Date.UTC(2026, 8, 5));

function row(overrides: Partial<BankFileRow> = {}): BankFileRow {
  return {
    beneficiaryName: 'TechZone Solutions Pvt Ltd',
    beneficiaryAccount: '50200012345678',
    ifsc: 'HDFC0001234',
    amount: toMinor(3_540_000),
    reference: 'PB-20260905-001/INV-9821',
    paymentDate,
    transactionType: 'RTGS',
    debitAccount: '00600350001234',
    ...overrides,
  };
}

describe('transaction type selection', () => {
  it('uses RTGS at and above the ₹2,00,000 threshold, NEFT below it', () => {
    expect(transactionTypeFor(toMinor(199_999))).toBe('NEFT');
    expect(transactionTypeFor(toMinor(200_000))).toBe('RTGS');
    expect(transactionTypeFor(toMinor(3_540_000))).toBe('RTGS');
  });
});

describe('bank file generation', () => {
  it('writes the HDFC column layout with amounts as numbers, not text', async () => {
    const file = await generateBankFile('HDFC', 'PB-20260905-001', [row()]);
    expect(file.fileName).toBe('PB-20260905-001.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Payments')!;

    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toContain('Beneficiary Account Number');
    expect(headers).toContain('IFSC Code');

    const amountColumn = headers.indexOf('Amount') + 1;
    const amountCell = sheet.getRow(2).getCell(amountColumn);
    // ₹35,40,000.00 must be the number 3540000, not a string.
    expect(typeof amountCell.value).toBe('number');
    expect(amountCell.value).toBe(3_540_000);
  });

  it('renders the ICICI layout with its own header names', async () => {
    const file = await generateBankFile('ICICI', 'PB-1', [row()]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const headers = (workbook.getWorksheet('Payments')!.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(
      expect.arrayContaining(['PYMT_MODE', 'BNF_ACC_NO', 'BNF_IFSC', 'AMOUNT']),
    );
  });

  it('produces CSV with CRLF line endings and quoted separators', async () => {
    const file = await generateBankFile('GENERIC_CSV', 'PB-1', [
      row({ beneficiaryName: 'Acme, Industries "North"' }),
    ]);
    const text = file.buffer.toString('utf8');

    expect(file.fileName).toBe('PB-1.csv');
    expect(text).toContain('\r\n');
    // A comma inside a field must be quoted, and inner quotes doubled, or the
    // bank's parser shifts every subsequent column.
    expect(text).toContain('"Acme, Industries ""North"""');
  });

  it('writes one row per payment and preserves paise exactly', async () => {
    const rows = [
      row({ amount: toMinor(82_000) }),
      row({ amount: toMinor(91_000.55) }),
      row({ amount: toMinor(64_000) }),
    ];
    const file = await generateBankFile('GENERIC_XLSX', 'PB-2', rows);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Payments')!;
    expect(sheet.rowCount).toBe(rows.length + 1);

    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const amountColumn = headers.indexOf('Amount') + 1;
    expect(sheet.getRow(3).getCell(amountColumn).value).toBe(91_000.55);
  });

  it('falls back to the generic layout for an unknown format', async () => {
    const file = await generateBankFile('SOMETHING_ELSE' as never, 'PB-3', [row()]);
    expect(file.fileName).toBe('PB-3.xlsx');
  });
});
