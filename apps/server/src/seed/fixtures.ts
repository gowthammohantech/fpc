import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import { env } from '../config/env.js';

/**
 * Writes the demo input files.
 *
 * The invoice fixture is a minimal but genuinely valid PDF carrying a real
 * text layer, so the credential-free extractor reads actual fields from it
 * rather than the demo depending on a hand-written extraction result.
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

export async function writePayrollWorkbook(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll');

  // A title block above the header, exactly as HR systems export it — the
  // importer must find the real header row underneath.
  sheet.addRow(['Nova Engineering Pvt Ltd']);
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

  const locations = [
    { name: 'Chennai', count: 320 },
    { name: 'Bengaluru', count: 280 },
    { name: 'Pune', count: 250 },
  ];
  const TARGET_TOTAL = 6_20_00_000;
  const headcount = locations.reduce((sum, location) => sum + location.count, 0);
  const mean = TARGET_TOTAL / headcount;

  // Vary salaries so the file looks real, then put the rounding residual on
  // the last row — the batch total has to land on the PRD's ₹6.20 Cr rather
  // than drifting by whatever the jitter happens to sum to.
  const salaries: number[] = [];
  for (let index = 0; index < headcount; index += 1) {
    salaries.push(Math.round(mean + ((index % 11) - 5) * 1000));
  }
  const residual = TARGET_TOTAL - salaries.reduce((sum, value) => sum + value, 0);
  salaries[salaries.length - 1] = (salaries.at(-1) ?? 0) + residual;

  let index = 0;
  for (const location of locations) {
    for (let i = 0; i < location.count; i += 1) {
      sheet.addRow([
        `EMP${String(index + 1).padStart(4, '0')}`,
        `Employee ${index + 1}`,
        `501000${String(1000000 + index).slice(-7)}`,
        ['HDFC0001234', 'ICIC0000221', 'SBIN0004567'][index % 3],
        salaries[index],
        index % 3 === 0 ? 'Engineering' : index % 3 === 1 ? 'Operations' : 'Finance',
        location.name,
      ]);
      index += 1;
    }
  }

  await workbook.xlsx.writeFile(path);
}

export async function writeStatementWorkbook(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

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

  await workbook.xlsx.writeFile(path);
}
