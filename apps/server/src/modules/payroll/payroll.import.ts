import {
  ValidationCode,
  ValidationSeverity,
  parseAmountToMinor,
  type ValidationFinding,
} from '@fpc/shared';
import { autoDetectColumns, readTable, type SheetTable } from './spreadsheet.js';

/**
 * Payroll import — PRD §17.
 *
 * The MVP does not calculate salary; it receives a finalised payroll file and
 * turns it into payment instructions. That makes validation the important
 * part: a wrong IFSC or a duplicated employee row becomes a failed or double
 * payment for a real person.
 */

export type PayrollField =
  | 'employeeCode'
  | 'employeeName'
  | 'bankAccountNumber'
  | 'ifsc'
  | 'netAmount'
  | 'department'
  | 'location'
  | 'email';

const COLUMN_ALIASES: Record<PayrollField, string[]> = {
  employeeCode: ['employee id', 'employee code', 'emp id', 'emp code', 'empno', 'employee number'],
  employeeName: ['employee name', 'name', 'emp name', 'full name'],
  bankAccountNumber: ['bank account', 'account number', 'bank a/c', 'account no', 'ac no', 'bank account number'],
  ifsc: ['ifsc', 'ifsc code', 'bank ifsc'],
  netAmount: ['net salary', 'net pay', 'net amount', 'net', 'amount', 'salary', 'take home'],
  department: ['department', 'dept', 'division'],
  location: ['location', 'branch', 'office', 'work location', 'city'],
  email: ['email', 'email id', 'e-mail', 'official email'],
};

export interface ParsedPayrollRow {
  rowNumber: number;
  employeeCode: string;
  employeeName: string;
  bankAccountNumber: string;
  ifsc: string;
  /** Minor units. */
  netAmount: number;
  departmentName?: string;
  locationName?: string;
  email?: string;
  findings: ValidationFinding[];
}

export interface PayrollImportResult {
  headers: string[];
  mapping: Partial<Record<PayrollField, string>>;
  rows: ParsedPayrollRow[];
  /** Rows too broken to import at all (no employee code, or no amount). */
  rejected: Array<{ rowNumber: number; reason: string }>;
  employeeCount: number;
  /** Minor units. */
  totalNetAmount: number;
  locationBreakdown: Array<{ locationName: string; count: number; amount: number }>;
  findings: ValidationFinding[];
}

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export async function parsePayrollFile(
  content: Buffer,
  fileName: string,
  overrides?: Partial<Record<PayrollField, string>>,
): Promise<PayrollImportResult> {
  const table = await readTable(content, fileName);
  return buildResult(table, overrides);
}

/** Split out from file reading so it can be tested without a real workbook. */
export function buildResult(
  table: SheetTable,
  overrides?: Partial<Record<PayrollField, string>>,
): PayrollImportResult {
  const mapping = { ...autoDetectColumns<PayrollField>(table.headers, COLUMN_ALIASES), ...overrides };

  const findings: ValidationFinding[] = [];
  const required: PayrollField[] = ['employeeCode', 'employeeName', 'bankAccountNumber', 'ifsc', 'netAmount'];
  for (const field of required) {
    if (!mapping[field]) {
      findings.push({
        code: ValidationCode.MISSING_VENDOR,
        severity: ValidationSeverity.ERROR,
        message: `Could not find a column for ${field}. Map it manually before importing.`,
        field,
      });
    }
  }
  if (findings.length) {
    return {
      headers: table.headers,
      mapping,
      rows: [],
      rejected: [],
      employeeCount: 0,
      totalNetAmount: 0,
      locationBreakdown: [],
      findings,
    };
  }

  const rows: ParsedPayrollRow[] = [];
  const rejected: Array<{ rowNumber: number; reason: string }> = [];
  const seenCodes = new Map<string, number>();
  const seenAccounts = new Map<string, string>();

  table.rows.forEach((record, index) => {
    const rowNumber = table.rowNumbers[index] ?? index + 1;
    const read = (field: PayrollField): string =>
      String(record[mapping[field] ?? ''] ?? '').trim();

    const employeeCode = read('employeeCode');
    const employeeName = read('employeeName');
    const netAmount = parseAmountToMinor(record[mapping.netAmount!]);

    if (!employeeCode && !employeeName) {
      rejected.push({ rowNumber, reason: 'No employee identified on this row' });
      return;
    }
    if (netAmount === null) {
      rejected.push({
        rowNumber,
        reason: `Net salary "${String(record[mapping.netAmount!] ?? '')}" is not a readable amount`,
      });
      return;
    }

    const bankAccountNumber = read('bankAccountNumber').replace(/\s/g, '');
    const ifsc = read('ifsc').toUpperCase().replace(/\s/g, '');
    const rowFindings: ValidationFinding[] = [];

    if (netAmount <= 0) {
      rowFindings.push(finding(ValidationCode.NEGATIVE_AMOUNT, ValidationSeverity.ERROR, 'Net salary must be greater than zero', 'netAmount'));
    }
    if (!bankAccountNumber) {
      rowFindings.push(finding(ValidationCode.MISSING_VENDOR_BANK_DETAILS, ValidationSeverity.ERROR, 'Bank account number is missing', 'bankAccountNumber'));
    } else if (!/^[A-Za-z0-9]+$/.test(bankAccountNumber)) {
      rowFindings.push(finding(ValidationCode.MISSING_VENDOR_BANK_DETAILS, ValidationSeverity.ERROR, `Bank account "${bankAccountNumber}" contains invalid characters`, 'bankAccountNumber'));
    } else if (/^X+\d{0,4}$/i.test(bankAccountNumber)) {
      // A masked number cannot be paid; this is a common copy-paste mistake
      // when payroll is exported from an HR system for review.
      rowFindings.push(finding(ValidationCode.MISSING_VENDOR_BANK_DETAILS, ValidationSeverity.ERROR, 'Bank account number appears to be masked and cannot be paid', 'bankAccountNumber'));
    }
    if (!IFSC_PATTERN.test(ifsc)) {
      rowFindings.push(finding(ValidationCode.MISSING_VENDOR_BANK_DETAILS, ValidationSeverity.ERROR, `"${ifsc}" is not a valid IFSC code`, 'ifsc'));
    }

    const previousRow = seenCodes.get(employeeCode);
    if (previousRow) {
      rowFindings.push(finding(ValidationCode.EXACT_DUPLICATE, ValidationSeverity.ERROR, `Employee ${employeeCode} already appears on row ${previousRow}`, 'employeeCode'));
    } else {
      seenCodes.set(employeeCode, rowNumber);
    }

    // Two employees sharing an account is legitimate occasionally (joint
    // accounts) but far more often a copy-paste error, so warn rather than block.
    if (bankAccountNumber) {
      const owner = seenAccounts.get(bankAccountNumber);
      if (owner && owner !== employeeCode) {
        rowFindings.push(finding(ValidationCode.POSSIBLE_DUPLICATE, ValidationSeverity.WARNING, `This bank account is also used by employee ${owner}`, 'bankAccountNumber'));
      } else {
        seenAccounts.set(bankAccountNumber, employeeCode);
      }
    }

    rows.push({
      rowNumber,
      employeeCode,
      employeeName,
      bankAccountNumber,
      ifsc,
      netAmount,
      departmentName: mapping.department ? read('department') || undefined : undefined,
      locationName: mapping.location ? read('location') || undefined : undefined,
      email: mapping.email ? read('email') || undefined : undefined,
      findings: rowFindings,
    });
  });

  const byLocation = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    const key = row.locationName || 'Unspecified';
    const entry = byLocation.get(key) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += row.netAmount;
    byLocation.set(key, entry);
  }

  const errorRows = rows.filter((row) =>
    row.findings.some((entry) => entry.severity === ValidationSeverity.ERROR),
  );
  if (errorRows.length) {
    findings.push({
      code: ValidationCode.MISSING_VENDOR_BANK_DETAILS,
      severity: ValidationSeverity.ERROR,
      message: `${errorRows.length} employee ${errorRows.length === 1 ? 'row has' : 'rows have'} errors that must be fixed before approval`,
    });
  }
  if (rejected.length) {
    findings.push({
      code: ValidationCode.MISSING_TOTAL,
      severity: ValidationSeverity.WARNING,
      message: `${rejected.length} ${rejected.length === 1 ? 'row was' : 'rows were'} skipped as unreadable`,
    });
  }

  return {
    headers: table.headers,
    mapping,
    rows,
    rejected,
    employeeCount: rows.length,
    totalNetAmount: rows.reduce((sum, row) => sum + row.netAmount, 0),
    locationBreakdown: [...byLocation.entries()]
      .map(([locationName, entry]) => ({ locationName, ...entry }))
      .sort((a, b) => b.amount - a.amount),
    findings,
  };
}

function finding(
  code: ValidationCode,
  severity: ValidationSeverity,
  message: string,
  field?: string,
): ValidationFinding {
  return { code, severity, message, field };
}

export { COLUMN_ALIASES };
