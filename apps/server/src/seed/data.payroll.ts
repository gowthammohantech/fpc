/**
 * Payroll runs.
 *
 * Four batches, each resting in a different status, so `/payroll`, the CFO's
 * month-on-month comparison, the payroll fan-out and the aggregated payment
 * queue line all have something real behind them.
 *
 * The engineering current run is the flagship demo (PRD §38) and is left
 * awaiting approval on purpose; its previous-month figure now comes from the
 * batch below it rather than from a hard-coded number.
 */

export interface PayrollLocationSpec {
  /** Company-qualified location key, e.g. `engineering:MAA`. */
  key: string;
  name: string;
  count: number;
}

export interface PayrollSpec {
  company: string;
  /** Months before the current one; 1 is last month. */
  monthsAgo: number;
  employeeCount: number;
  /** Rupees. */
  targetTotal: number;
  employeeCodePrefix: string;
  locations: PayrollLocationSpec[];
}

/** PRD §38: 850 employees, ₹6.20 Cr, split across three locations. */
export const PAYROLL: PayrollSpec = {
  company: 'engineering',
  monthsAgo: 1,
  employeeCount: 850,
  targetTotal: 6_20_00_000,
  employeeCodePrefix: 'EMP',
  locations: [
    { key: 'engineering:MAA', name: 'Chennai', count: 320 },
    { key: 'engineering:BLR', name: 'Bengaluru', count: 280 },
    { key: 'engineering:PNQ', name: 'Pune', count: 250 },
  ],
};

/**
 * The month before, run to completion: approved, fanned out to one obligation
 * per employee, paid through a bank file and reconciled against a statement.
 * ₹6.08 Cr is the figure the CFO screen compares this month against.
 */
export const PAYROLL_PREVIOUS: PayrollSpec = {
  company: 'engineering',
  monthsAgo: 2,
  employeeCount: 842,
  targetTotal: 6_08_00_000,
  employeeCodePrefix: 'EMP',
  locations: [
    { key: 'engineering:MAA', name: 'Chennai', count: 316 },
    { key: 'engineering:BLR', name: 'Bengaluru', count: 278 },
    { key: 'engineering:PNQ', name: 'Pune', count: 248 },
  ],
};

/**
 * Nova Technologies, approved and fanned out but not yet batched — this is
 * what gives the payment queue its aggregated payroll line, the one a caller
 * without `payroll:read` sees instead of individual salaries.
 */
export const PAYROLL_TECHNOLOGIES: PayrollSpec = {
  company: 'technologies',
  monthsAgo: 2,
  employeeCount: 46,
  targetTotal: 38_50_000,
  employeeCodePrefix: 'NT',
  locations: [
    { key: 'technologies:HYD', name: 'Hyderabad', count: 30 },
    { key: 'technologies:BLR', name: 'Bengaluru', count: 16 },
  ],
};

/**
 * This month's Nova Technologies import, stopped at review because three rows
 * cannot be paid as they stand. Shows the importer's per-row findings and the
 * batch-level error that blocks approval.
 */
export const PAYROLL_TECHNOLOGIES_REVIEW: PayrollSpec = {
  company: 'technologies',
  monthsAgo: 1,
  employeeCount: 44,
  targetTotal: 36_20_000,
  employeeCodePrefix: 'NT',
  locations: [
    { key: 'technologies:HYD', name: 'Hyderabad', count: 28 },
    { key: 'technologies:BLR', name: 'Bengaluru', count: 16 },
  ],
};

/** Rows the importer would reject, applied to the review batch by index. */
export const PAYROLL_BAD_ROWS = [
  {
    index: 4,
    bankAccountNumber: 'XXXX4417',
    message: 'Bank account number appears to be masked and cannot be paid',
    field: 'bankAccountNumber',
  },
  {
    index: 11,
    ifsc: 'HDFC123',
    message: '"HDFC123" is not a valid IFSC code',
    field: 'ifsc',
  },
  {
    index: 27,
    netAmount: 0,
    message: 'Net salary must be greater than zero',
    field: 'netAmount',
  },
];

export const FIRST_NAMES = [
  'Arun',
  'Divya',
  'Kumar',
  'Meera',
  'Rahul',
  'Sneha',
  'Vikram',
  'Anita',
  'Suresh',
  'Kavya',
  'Rajesh',
  'Deepa',
  'Manoj',
  'Priya',
  'Sanjay',
  'Lakshmi',
  'Ganesh',
  'Nisha',
  'Ravi',
  'Pooja',
];

export const LAST_NAMES = [
  'Sharma',
  'Nair',
  'Reddy',
  'Iyer',
  'Menon',
  'Patel',
  'Kulkarni',
  'Rao',
  'Pillai',
  'Krishnan',
  'Desai',
  'Joshi',
  'Bhat',
  'Chandra',
  'Varma',
  'Mehta',
  'Gupta',
  'Singh',
  'Das',
  'Bose',
];

export const IFSC_CODES = ['HDFC0001234', 'ICIC0000221', 'SBIN0004567', 'HDFC0004321'];
