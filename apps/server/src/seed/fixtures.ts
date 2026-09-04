import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import { fromMinor } from '@fpc/shared';
import { env } from '../config/env.js';
import { COMPANIES } from './data.org.js';
import { PAYROLL } from './data.payroll.js';
import { buildPayrollEmployees, type PayrollRow } from './payrollRows.js';

/**
 * Writes the demo input files.
 *
 * The invoice fixture is a minimal but genuinely valid PDF carrying a real
 * text layer, so the credential-free extractor reads actual fields from it
 * rather than the demo depending on a hand-written extraction result.
 *
 * The payroll workbook is generated from the same row builder as the seeded
 * database batch, so uploading it reproduces the register that is already
 * there rather than a lookalike with different names and account numbers.
 */
export async function writeFixtures(): Promise<void> {
  await writeInvoicePdf(`${env.MAIL_FIXTURE_DIR}/INV-9930.pdf`);
  await writePayrollWorkbook('fixtures/payroll/September-Payroll.xlsx');
  await writeStatementWorkbook('fixtures/statements/HDFC-Statement.xlsx');
}

export async function writeInvoicePdf(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const lines = [
    'TechZone Solutions Pvt Ltd',
    'GSTIN: 33AAACT2727Q1ZW',
    'TAX INVOICE',
    'Invoice Number: INV-9930',
    'Invoice Date: 05-Sep-2026',
    'Due Date: 05-Oct-2026',
    'Bill To: Nova Engineering Pvt Ltd',
    'Description: Enterprise software licences and support',
    'Sub Total: 1200000.00',
    'Total Tax: 216000.00',
    'Grand Total: 1416000.00',
    'Bank: HDFC Bank  A/c: 50200012345678  IFSC: HDFC0001234',
  ];

  await writeFile(path, buildPdf(lines));

  // A sidecar tells the fixture mail driver who "sent" it.
  await writeFile(
    `${path}.meta.json`,
    JSON.stringify(
      {
        from: 'accounts@techzone.example.com',
        subject: 'Invoice INV-9930',
      },
      null,
      2,
    ),
  );
}

/** Builds a single-page PDF with a selectable text layer. */
export function buildPdf(lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/([()\\])/g, '\\$1');
  const content =
    `BT\n/F1 11 Tf\n14 TL\n50 780 Td\n` +
    lines.map((line) => `(${escape(line)}) Tj T*`).join('\n') +
    `\nET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

/**
 * Renders a payroll register as the workbook an HR system would export.
 *
 * A title block sits above the header, exactly as those exports do — the
 * importer has to find the real header row underneath.
 */
export async function buildPayrollWorkbook(
  rows: PayrollRow[],
  companyKey: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll');
  const company = COMPANIES.find((entry) => entry.key === companyKey);

  sheet.addRow([company?.name ?? 'Payroll register']);
  sheet.addRow(['Payroll register']);
  sheet.addRow([]);
  sheet.addRow([
    'Employee ID',
    'Employee Name',
    'Bank Account',
    'IFSC',
    'Net Salary',
    'Department',
    'Location',
  ]);

  for (const row of rows) {
    sheet.addRow([
      row.employeeCode,
      row.employeeName,
      row.bankAccountNumber,
      row.ifsc,
      fromMinor(row.netAmount),
      row.departmentName,
      row.locationName,
    ]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function writePayrollWorkbook(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    await buildPayrollWorkbook(buildPayrollEmployees(PAYROLL), PAYROLL.company),
  );
}

export async function buildStatementWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');

  sheet.addRow(['HDFC Bank — Statement of Account']);
  sheet.addRow(['Account: 00600350001234']);
  sheet.addRow([]);
  sheet.addRow([
    'Transaction Date',
    'Narration',
    'Reference',
    'Withdrawal',
    'Deposit',
    'Closing Balance',
  ]);

  const today = new Date();
  const stamp = (offset: number) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  // Deliberately mixed: lines that should match cleanly, a bank charge that
  // should be ignored, and a credit that is not ours to reconcile.
  //
  // The row count is asserted by `fixtures.test.ts` (four debits, one credit),
  // and the amounts are load-bearing for the flagship journey — see the
  // reconciliation-ambiguity note in `data.invoices.ts` before changing any.
  let balance = 8_92_00_000;
  const rows: Array<[string, string, string, number | '', number | '']> = [
    [stamp(-1), 'NEFT TECHZONE SOLUTIONS', 'N2026090512345', 35_40_000, ''],
    [stamp(-1), 'NEFT AMAZON WEB SERVICES INDIA', 'N2026090512346', 8_20_000, ''],
    [stamp(-1), 'BANK CHARGES NEFT OUTWARD', 'CHG0912', 590, ''],
    [stamp(0), 'RTGS ABC INDUSTRIAL SUPPLIES LTD', 'R2026090612347', 12_00_000, ''],
    [stamp(0), 'CUSTOMER RECEIPT ORION SYSTEMS', 'C2026090612348', '', 45_00_000],
  ];

  for (const [date, narration, reference, debit, credit] of rows) {
    balance =
      balance - (typeof debit === 'number' ? debit : 0) + (typeof credit === 'number' ? credit : 0);
    sheet.addRow([date, narration, reference, debit, credit, balance]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function writeStatementWorkbook(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await buildStatementWorkbook());
}
