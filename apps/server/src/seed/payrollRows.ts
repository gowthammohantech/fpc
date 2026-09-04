import { toMinor } from '@fpc/shared';
import { FIRST_NAMES, IFSC_CODES, LAST_NAMES, type PayrollSpec } from './data.payroll.js';

export interface PayrollRow {
  employeeCode: string;
  employeeName: string;
  bankAccountNumber: string;
  ifsc: string;
  /** Minor units. */
  netAmount: number;
  departmentName: string;
  locationName: string;
  /** Company-qualified location key, e.g. `engineering:MAA`. */
  locationKey: string;
}

/**
 * The one payroll register generator.
 *
 * Both the database batch and the importable workbook are built from this, so
 * `September-Payroll.xlsx` really is the file that produced the seeded rows
 * rather than a lookalike with different names and account numbers.
 *
 * Salaries are spread deterministically around the mean and the rounding
 * residual is put on the last row, so the batch total lands exactly on the
 * spec's figure instead of drifting by whatever the jitter happens to sum to.
 * Every amount stays a whole number of rupees, so the workbook round-trips
 * through the importer without floating-point drift.
 */
export function buildPayrollEmployees(spec: PayrollSpec): PayrollRow[] {
  const rows: PayrollRow[] = [];

  // A whole-rupee mean, so every generated amount is a whole rupee too.
  const mean = Math.round(toMinor(spec.targetTotal) / spec.employeeCount / 100) * 100;
  const jitter = toMinor(1000);
  let index = 0;

  for (const location of spec.locations) {
    for (let i = 0; i < location.count; i += 1) {
      rows.push({
        employeeCode: `${spec.employeeCodePrefix}${String(index + 1).padStart(4, '0')}`,
        employeeName: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[(index * 7) % LAST_NAMES.length]}`,
        bankAccountNumber: `501000${String(1000000 + index).slice(-7)}`,
        ifsc: IFSC_CODES[index % IFSC_CODES.length]!,
        netAmount: mean + ((index % 11) - 5) * jitter,
        departmentName:
          index % 3 === 0 ? 'Engineering' : index % 3 === 1 ? 'Operations' : 'Finance',
        locationName: location.name,
        locationKey: location.key,
      });
      index += 1;
    }
  }

  const total = rows.reduce((sum, row) => sum + row.netAmount, 0);
  rows[rows.length - 1]!.netAmount += toMinor(spec.targetTotal) - total;

  return rows;
}
