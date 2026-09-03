import ExcelJS from 'exceljs';
import { fromMinor, type BankFileFormat } from '@fpc/shared';

/**
 * Bank file generation — PRD §23.
 *
 * There is no bank integration in the MVP: the platform produces the upload
 * file, a treasury user takes it to the corporate banking portal, and the
 * payment happens outside the product. Each bank wants a slightly different
 * sheet, so the formats are declared as column maps rather than written as
 * separate generators.
 */

export interface BankFileRow {
  beneficiaryName: string;
  beneficiaryAccount: string;
  ifsc: string;
  /** Minor units. */
  amount: number;
  reference: string;
  paymentDate: Date;
  email?: string;
  /** NEFT / RTGS / IMPS, chosen from the amount. */
  transactionType: string;
  debitAccount?: string;
}

export interface BankFileColumn {
  header: string;
  width?: number;
  value: (row: BankFileRow) => string | number;
}

export interface BankFileDefinition {
  format: BankFileFormat;
  label: string;
  extension: 'xlsx' | 'csv';
  contentType: string;
  sheetName: string;
  columns: BankFileColumn[];
}

/**
 * Indian rails have a hard rule that matters for file acceptance: RTGS has a
 * ₹2,00,000 minimum, and NEFT is used below that.
 */
export function transactionTypeFor(amountMinor: number): string {
  return amountMinor >= 20_000_000 ? 'RTGS' : 'NEFT';
}

const amount = (row: BankFileRow): number => fromMinor(row.amount);
const isoDate = (row: BankFileRow): string => row.paymentDate.toISOString().slice(0, 10);
const ddmmyyyy = (row: BankFileRow): string => {
  const date = row.paymentDate;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
};

export const BANK_FILE_DEFINITIONS: Record<BankFileFormat, BankFileDefinition> = {
  HDFC: {
    format: 'HDFC',
    label: 'HDFC Bank bulk payment',
    extension: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sheetName: 'Payments',
    columns: [
      { header: 'Transaction Type', width: 16, value: (row) => row.transactionType },
      { header: 'Beneficiary Code', width: 20, value: (row) => row.reference },
      { header: 'Beneficiary Account Number', width: 26, value: (row) => row.beneficiaryAccount },
      { header: 'Beneficiary Name', width: 32, value: (row) => row.beneficiaryName },
      { header: 'Amount', width: 16, value: amount },
      { header: 'Debit Account No', width: 22, value: (row) => row.debitAccount ?? '' },
      { header: 'Payment Date', width: 14, value: ddmmyyyy },
      { header: 'IFSC Code', width: 14, value: (row) => row.ifsc },
      { header: 'Payment Ref No', width: 24, value: (row) => row.reference },
      { header: 'Beneficiary Email', width: 28, value: (row) => row.email ?? '' },
    ],
  },
  ICICI: {
    format: 'ICICI',
    label: 'ICICI Bank corporate payment',
    extension: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sheetName: 'Payments',
    columns: [
      { header: 'PYMT_MODE', width: 14, value: (row) => row.transactionType },
      { header: 'DEBIT_ACC_NO', width: 22, value: (row) => row.debitAccount ?? '' },
      { header: 'BNF_NAME', width: 32, value: (row) => row.beneficiaryName },
      { header: 'BNF_ACC_NO', width: 26, value: (row) => row.beneficiaryAccount },
      { header: 'BNF_IFSC', width: 14, value: (row) => row.ifsc },
      { header: 'AMOUNT', width: 16, value: amount },
      { header: 'PYMT_DATE', width: 14, value: ddmmyyyy },
      { header: 'REMARKS', width: 24, value: (row) => row.reference },
      { header: 'BNF_EMAIL', width: 28, value: (row) => row.email ?? '' },
    ],
  },
  GENERIC_XLSX: {
    format: 'GENERIC_XLSX',
    label: 'Generic Excel',
    extension: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sheetName: 'Payments',
    columns: genericColumns(),
  },
  GENERIC_CSV: {
    format: 'GENERIC_CSV',
    label: 'Generic CSV',
    extension: 'csv',
    contentType: 'text/csv',
    sheetName: 'Payments',
    columns: genericColumns(),
  },
};

function genericColumns(): BankFileColumn[] {
  return [
    { header: 'Payment Date', width: 14, value: isoDate },
    { header: 'Transaction Type', width: 16, value: (row) => row.transactionType },
    { header: 'Beneficiary Name', width: 32, value: (row) => row.beneficiaryName },
    { header: 'Account Number', width: 26, value: (row) => row.beneficiaryAccount },
    { header: 'IFSC', width: 14, value: (row) => row.ifsc },
    { header: 'Amount', width: 16, value: amount },
    { header: 'Reference', width: 24, value: (row) => row.reference },
    { header: 'Email', width: 28, value: (row) => row.email ?? '' },
  ];
}

export interface GeneratedBankFile {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

/** Renders the rows into the bank's expected sheet or CSV. */
export async function generateBankFile(
  format: BankFileFormat,
  reference: string,
  rows: BankFileRow[],
): Promise<GeneratedBankFile> {
  const definition = BANK_FILE_DEFINITIONS[format] ?? BANK_FILE_DEFINITIONS.GENERIC_XLSX;
  const fileName = `${reference}.${definition.extension}`;

  if (definition.extension === 'csv') {
    const lines = [
      definition.columns.map((column) => csvCell(column.header)).join(','),
      ...rows.map((row) => definition.columns.map((column) => csvCell(column.value(row))).join(',')),
    ];
    return {
      buffer: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
      fileName,
      contentType: definition.contentType,
    };
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Finance Operations';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(definition.sheetName);

  sheet.columns = definition.columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width ?? 18,
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(definition.columns.map((column) => column.value(row)));
  }

  // Amounts must render as 2-decimal numbers, not as text or scientific
  // notation, or the bank's parser rejects the file.
  const amountIndex = definition.columns.findIndex((column) => /amount/i.test(column.header));
  if (amountIndex >= 0) sheet.getColumn(amountIndex + 1).numFmt = '0.00';

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), fileName, contentType: definition.contentType };
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
