import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import { parsePayrollFile } from './payroll.import.js';
import { autoDetectColumns, readTable } from './spreadsheet.js';

async function workbookOf(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const HEADERS = [
  'Employee ID',
  'Employee Name',
  'Bank Account',
  'IFSC',
  'Net Salary',
  'Department',
  'Location',
];
const GOOD_ROWS = [
  ['EMP001', 'Arun', '50100012345678', 'HDFC0001234', 82000, 'Engineering', 'Chennai'],
  ['EMP002', 'Divya', '00110022334455', 'ICIC0000221', 91000, 'Sales', 'Bengaluru'],
  ['EMP003', 'Kumar', '50100087654321', 'HDFC0001234', 64000, 'Engineering', 'Pune'],
];

describe('payroll import', () => {
  it('reads a clean payroll sheet and totals it exactly', async () => {
    const result = await parsePayrollFile(
      await workbookOf([HEADERS, ...GOOD_ROWS]),
      'payroll.xlsx',
    );

    expect(result.employeeCount).toBe(3);
    expect(result.totalNetAmount).toBe(toMinor(82_000 + 91_000 + 64_000));
    expect(result.rows.every((row) => row.findings.length === 0)).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('breaks the batch down by location, largest first', async () => {
    const result = await parsePayrollFile(
      await workbookOf([HEADERS, ...GOOD_ROWS]),
      'payroll.xlsx',
    );
    expect(result.locationBreakdown).toEqual([
      { locationName: 'Bengaluru', count: 1, amount: toMinor(91_000) },
      { locationName: 'Chennai', count: 1, amount: toMinor(82_000) },
      { locationName: 'Pune', count: 1, amount: toMinor(64_000) },
    ]);
  });

  it('skips a title block above the real header row', async () => {
    const buffer = await workbookOf([
      ['Nova Engineering Pvt Ltd'],
      ['Payroll for September 2026'],
      [],
      HEADERS,
      ...GOOD_ROWS,
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    expect(result.employeeCount).toBe(3);
    expect(result.mapping.employeeCode).toBe('Employee ID');
  });

  it('reports the sheet row number so an error points at the right line', async () => {
    const buffer = await workbookOf([
      HEADERS,
      GOOD_ROWS[0]!,
      ['EMP004', 'Meera', '50100011112222', 'BADIFSC', 70000, 'Ops', 'Chennai'],
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');

    const bad = result.rows.find((row) => row.employeeCode === 'EMP004')!;
    expect(bad.rowNumber).toBe(3);
    expect(bad.findings.map((finding) => finding.field)).toContain('ifsc');
  });

  it('rejects an invalid IFSC as an error, not a warning', async () => {
    const buffer = await workbookOf([HEADERS, ['EMP1', 'A', '123456', 'NOTANIFSC', 1000, '', '']]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    expect(result.rows[0]!.findings.some((f) => f.field === 'ifsc' && f.severity === 'ERROR')).toBe(
      true,
    );
    expect(result.findings.some((f) => f.severity === 'ERROR')).toBe(true);
  });

  it('refuses a masked account number, which cannot be paid', async () => {
    const buffer = await workbookOf([
      HEADERS,
      ['EMP1', 'A', 'XXXX8291', 'HDFC0001234', 1000, '', ''],
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    expect(
      result.rows[0]!.findings.some(
        (f) => f.field === 'bankAccountNumber' && f.severity === 'ERROR',
      ),
    ).toBe(true);
  });

  it('catches a duplicated employee, which would pay someone twice', async () => {
    const buffer = await workbookOf([HEADERS, GOOD_ROWS[0]!, GOOD_ROWS[0]!]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    const duplicate = result.rows[1]!.findings.find((f) => f.field === 'employeeCode');
    expect(duplicate?.severity).toBe('ERROR');
    expect(duplicate?.message).toContain('row 2');
  });

  it('warns when two employees share a bank account', async () => {
    const buffer = await workbookOf([
      HEADERS,
      GOOD_ROWS[0]!,
      ['EMP009', 'Other', '50100012345678', 'HDFC0001234', 50000, '', ''],
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    const warning = result.rows[1]!.findings.find((f) => f.field === 'bankAccountNumber');
    expect(warning?.severity).toBe('WARNING');
  });

  it('skips unreadable rows instead of importing a wrong amount', async () => {
    const buffer = await workbookOf([
      HEADERS,
      ['EMP1', 'A', '123456', 'HDFC0001234', 'N/A', '', ''],
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('not a readable amount');
  });

  it('reports missing required columns rather than importing a partial batch', async () => {
    const buffer = await workbookOf([
      ['Employee ID', 'Employee Name'],
      ['EMP1', 'A'],
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    expect(result.rows).toHaveLength(0);
    expect(result.findings.map((f) => f.field)).toEqual(
      expect.arrayContaining(['bankAccountNumber', 'ifsc', 'netAmount']),
    );
  });

  it('reads CSV as well as XLSX', async () => {
    const csv = [HEADERS.join(','), ...GOOD_ROWS.map((row) => row.join(','))].join('\n');
    const result = await parsePayrollFile(Buffer.from(csv, 'utf8'), 'payroll.csv');
    expect(result.employeeCount).toBe(3);
    expect(result.totalNetAmount).toBe(toMinor(237_000));
  });

  it('parses amounts with Indian grouping and currency symbols', async () => {
    const buffer = await workbookOf([
      HEADERS,
      ['EMP1', 'A', '123456', 'HDFC0001234', '₹1,00,000.50', '', ''],
    ]);
    const result = await parsePayrollFile(buffer, 'payroll.xlsx');
    expect(result.rows[0]!.netAmount).toBe(toMinor(100_000.5));
  });

  it('scales to a full payroll run', async () => {
    const rows = Array.from({ length: 850 }, (_, index) => [
      `EMP${String(index + 1).padStart(4, '0')}`,
      `Employee ${index + 1}`,
      `5010001234${String(index).padStart(4, '0')}`,
      'HDFC0001234',
      72_941,
      'Engineering',
      ['Chennai', 'Bengaluru', 'Pune'][index % 3],
    ]);
    const result = await parsePayrollFile(await workbookOf([HEADERS, ...rows]), 'payroll.xlsx');

    expect(result.employeeCount).toBe(850);
    expect(result.totalNetAmount).toBe(toMinor(72_941 * 850));
    expect(result.locationBreakdown).toHaveLength(3);
    expect(result.rows.every((row) => row.findings.length === 0)).toBe(true);
  });
});

describe('column auto-detection', () => {
  it('accepts the header names payroll files actually use', () => {
    const mapping = autoDetectColumns(['EMP CODE', 'NAME', 'A/C No', 'IFSC Code', 'NET PAY'], {
      employeeCode: ['employee id', 'employee code', 'emp code'],
      employeeName: ['employee name', 'name'],
      bankAccountNumber: ['bank account', 'account no', 'ac no'],
      ifsc: ['ifsc'],
      netAmount: ['net salary', 'net pay', 'amount'],
    });

    expect(mapping).toMatchObject({
      employeeCode: 'EMP CODE',
      employeeName: 'NAME',
      bankAccountNumber: 'A/C No',
      ifsc: 'IFSC Code',
      netAmount: 'NET PAY',
    });
  });

  it('does not map two fields onto the same column', () => {
    const mapping = autoDetectColumns(['Amount'], {
      netAmount: ['amount'],
      other: ['amount'],
    });
    expect(mapping.netAmount).toBe('Amount');
    expect(mapping.other).toBeUndefined();
  });
});

describe('spreadsheet reader', () => {
  it('gives blank header cells a stable key', async () => {
    const buffer = await workbookOf([
      ['Name', '', 'Amount'],
      ['A', 'x', 1],
    ]);
    const table = await readTable(buffer, 'file.xlsx');
    expect(table.headers).toEqual(['Name', 'Column 2', 'Amount']);
    expect(table.rows[0]).toMatchObject({ Name: 'A', 'Column 2': 'x', Amount: 1 });
  });

  it('ignores fully blank rows', async () => {
    const buffer = await workbookOf([['Name'], ['A'], [], ['B']]);
    const table = await readTable(buffer, 'file.xlsx');
    expect(table.rows).toHaveLength(2);
  });
});
