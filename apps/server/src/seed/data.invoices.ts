import { ValidationCode, ValidationSeverity } from '@fpc/shared';

/**
 * The invoice register.
 *
 * Between them these rows put at least one invoice in every status the product
 * can rest in, and at least one finding of every code the invoice validator
 * produces, so no screen or report starts empty.
 *
 * CONSTRAINT — reconciliation ambiguity. `candidatesFor` considers every
 * obligation in the same company within ±0.5% of a bank debit, and `bestMatch`
 * refuses to choose between two candidates within five points of each other.
 * The demo statement carries debits of ₹35,40,000, ₹8,20,000, ₹12,00,000 and
 * ₹590, so no invoice that reaches a batch may land within 0.5% of any of
 * them. Adding one silently breaks the flagship journey with a "no suggestion"
 * that looks like a matcher bug.
 *
 * CONSTRAINT — pagination. The review queue sorts newest first, 25 to a page,
 * and the journeys test expects INV-9821 (3 days old) on page one. Every other
 * invoice is therefore at least 4 days old.
 */

export type InvoiceStop =
  | 'RECEIVED'
  | 'REVIEW_REQUIRED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DUPLICATE'
  | 'PENDING_APPROVAL'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'APPROVED';

export interface FindingSeed {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  field?: string;
  resolved?: boolean;
  resolutionNote?: string;
  /** Invoice numbers this finding points at, resolved to ids by the writer. */
  relatedInvoiceNumbers?: string[];
}

export interface InvoiceSeed {
  company: string;
  /** Stable key for the "already seeded?" check; defaults to invoiceNumber. */
  seedKey?: string;
  /** Vendor code, or absent when extraction could not identify one. */
  vendor?: string;
  department?: string;
  location?: string;
  invoiceNumber?: string;
  daysAgo: number;
  dueInDays?: number;
  /** Rupees; converted to minor units by the writer. */
  subtotal?: number;
  tax?: number;
  total?: number;
  source?: 'EMAIL' | 'UPLOAD';
  /** Line shown on the generated PDF, so the document matches the fields. */
  description?: string;
  stopAt: InvoiceStop;
  /** Comment recorded against the approval decision, for REJECTED rows. */
  decisionComment?: string;
  /** Reason recorded on the audit trail, for CANCELLED rows. */
  cancelReason?: string;
  findings?: FindingSeed[];
  /** Replaces the default high-confidence extraction block. */
  extraction?: 'DEFAULT' | 'SPARSE' | 'NONE';
  extractionError?: string;
  extractionAttempts?: number;
}

/** The one finding the flagship demo relies on: a field worth verifying. */
const LOW_CONFIDENCE_TAX: FindingSeed = {
  code: ValidationCode.LOW_CONFIDENCE_FIELD,
  severity: ValidationSeverity.INFO,
  message: 'taxAmount was extracted with 81% confidence — please verify',
  field: 'taxAmount',
};

export const INVOICES: InvoiceSeed[] = [
  // ── The flagship. Left in review so the demo walks it through. ──
  {
    company: 'engineering',
    vendor: 'TECHZONE',
    department: 'IT',
    location: 'MAA',
    invoiceNumber: 'INV-9821',
    daysAgo: 3,
    dueInDays: 5,
    subtotal: 30_00_000,
    tax: 5_40_000,
    total: 35_40_000,
    description: 'Enterprise software licences and support',
    stopAt: 'REVIEW_REQUIRED',
    findings: [LOW_CONFIDENCE_TAX],
  },

  // ── Approved and waiting in the payment queue ────────────
  {
    company: 'engineering',
    vendor: 'AWS',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV-2381',
    daysAgo: 6,
    dueInDays: 7,
    subtotal: 6_94_915,
    tax: 1_25_085,
    total: 8_20_000,
    description: 'Cloud infrastructure — monthly usage',
    stopAt: 'APPROVED',
    findings: [LOW_CONFIDENCE_TAX],
  },
  {
    company: 'engineering',
    vendor: 'ZENITH',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-4410',
    daysAgo: 40,
    dueInDays: -12,
    subtotal: 4_23_729,
    tax: 76_271,
    total: 5_00_000,
    description: 'Structural steel supply — order ZM-4410',
    stopAt: 'APPROVED',
  },
  {
    // Its obligation is later put on hold, pending a credit note.
    company: 'engineering',
    vendor: 'AWS',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV-2210',
    daysAgo: 45,
    dueInDays: -18,
    subtotal: 76_271,
    tax: 13_729,
    total: 90_000,
    description: 'Cloud infrastructure — support plan',
    stopAt: 'APPROVED',
  },

  // ── Mid-approval, so the inbox and the SLA column are not empty ──
  {
    // Routes through the Pune rule: the site head has signed, finance has not.
    company: 'engineering',
    vendor: 'ABCLTD',
    department: 'OPS',
    location: 'PNQ',
    invoiceNumber: 'INV-882',
    daysAgo: 9,
    dueInDays: 10,
    subtotal: 10_16_949,
    tax: 1_83_051,
    total: 12_00_000,
    description: 'Industrial consumables — Q3 supply',
    stopAt: 'PARTIALLY_APPROVED',
  },

  {
    // Above ₹10L, so it routes through the full three-level ladder and is
    // left at the first. Steps two and three rest PENDING, which is the only
    // place that step status is visible.
    company: 'engineering',
    vendor: 'ORION',
    department: 'IT',
    location: 'MAA',
    invoiceNumber: 'INV-6618',
    daysAgo: 7,
    dueInDays: 23,
    subtotal: 19_06_780,
    tax: 3_43_220,
    total: 22_50_000,
    description: 'Test bench instrumentation',
    stopAt: 'PENDING_APPROVAL',
    findings: [LOW_CONFIDENCE_TAX],
  },

  // ── In flight through the payment pipeline ───────────────
  {
    company: 'engineering',
    vendor: 'ORION',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-5501',
    daysAgo: 12,
    dueInDays: 18,
    subtotal: 12_71_186,
    tax: 2_28_814,
    total: 15_00_000,
    description: 'Plant automation controllers',
    stopAt: 'APPROVED',
  },
  {
    company: 'engineering',
    vendor: 'ORION',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV-5502',
    daysAgo: 15,
    dueInDays: 15,
    subtotal: 5_50_847,
    tax: 99_153,
    total: 6_50_000,
    description: 'Network hardware refresh',
    stopAt: 'APPROVED',
  },
  {
    company: 'engineering',
    vendor: 'ABCLTD',
    department: 'OPS',
    location: 'PNQ',
    invoiceNumber: 'INV-5503',
    daysAgo: 16,
    dueInDays: 9,
    subtotal: 9_74_576,
    tax: 1_75_424,
    total: 11_50_000,
    description: 'Bearings and drive components',
    stopAt: 'APPROVED',
  },
  {
    company: 'engineering',
    vendor: 'ZENITH',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-5504',
    daysAgo: 16,
    dueInDays: 12,
    subtotal: 7_20_339,
    tax: 1_29_661,
    total: 8_50_000,
    description: 'Alloy sheet — order ZM-5504',
    stopAt: 'APPROVED',
  },
  {
    // Approved, and then stuck: the vendor master has no bank account, so no
    // payment obligation can be created. The AP screen shows why.
    company: 'engineering',
    vendor: 'SWIFTLOG',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-5508',
    daysAgo: 18,
    dueInDays: 12,
    subtotal: 2_71_186,
    tax: 48_814,
    total: 3_20_000,
    description: 'Inbound freight — August consignments',
    stopAt: 'APPROVED',
  },

  // ── Terminal states ──────────────────────────────────────
  {
    company: 'engineering',
    vendor: 'TECHZONE',
    department: 'IT',
    location: 'MAA',
    invoiceNumber: 'INV-6610',
    daysAgo: 22,
    dueInDays: 8,
    subtotal: 1_52_542,
    tax: 27_458,
    total: 1_80_000,
    description: 'Additional user licences',
    stopAt: 'REJECTED',
    decisionComment: 'Not budgeted this quarter. Raise again after the October review.',
  },
  {
    // The same invoice re-sent with different punctuation. The platform
    // normalises the number, so this is an exact duplicate of INV-2210.
    company: 'engineering',
    vendor: 'AWS',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV/2210',
    daysAgo: 24,
    dueInDays: 6,
    subtotal: 76_271,
    tax: 13_729,
    total: 90_000,
    description: 'Cloud infrastructure — support plan',
    stopAt: 'DUPLICATE',
    findings: [
      {
        code: ValidationCode.EXACT_DUPLICATE,
        severity: ValidationSeverity.WARNING,
        message: 'Same vendor, invoice number and amount as INV-2210',
        relatedInvoiceNumbers: ['INV-2210'],
      },
    ],
  },
  {
    company: 'engineering',
    vendor: 'GLOBALX',
    department: 'OPS',
    location: 'PNQ',
    invoiceNumber: 'INV-6612',
    daysAgo: 26,
    dueInDays: 4,
    subtotal: 2_11_864,
    tax: 38_136,
    total: 2_50_000,
    description: 'Trading goods — consignment 6612',
    stopAt: 'CANCELLED',
    cancelReason: 'Vendor is blocked pending a GST compliance review',
  },

  // ── Still in the review queue, each for a different reason ──
  {
    company: 'engineering',
    vendor: 'PRIMEFAC',
    department: 'OPS',
    location: 'PNQ',
    invoiceNumber: 'INV-6614',
    daysAgo: 30,
    dueInDays: -5,
    subtotal: 3_00_000,
    tax: 54_000,
    // Deliberately not 3,54,000: the arithmetic on the document does not add up.
    total: 3_60_000,
    description: 'Facility management — quarterly retainer',
    stopAt: 'REVIEW_REQUIRED',
    findings: [
      {
        code: ValidationCode.TOTAL_MISMATCH,
        severity: ValidationSeverity.WARNING,
        message: 'Subtotal plus tax is ₹3,54,000 but the stated total is ₹3,60,000',
        field: 'totalAmount',
      },
    ],
  },
  {
    // Extraction gave up. The retry worker will pick it up again.
    company: 'engineering',
    vendor: 'ORION',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV-6615',
    daysAgo: 32,
    dueInDays: -34,
    subtotal: 84_746,
    tax: 15_254,
    total: 1_00_000,
    description: 'Scanned purchase bill',
    stopAt: 'FAILED',
    extractionError: 'Extractor timed out after 30s reading page 1',
    extractionAttempts: 2,
    findings: [
      {
        code: ValidationCode.DUE_DATE_BEFORE_INVOICE_DATE,
        severity: ValidationSeverity.WARNING,
        message: 'The due date read from the document is before the invoice date',
        field: 'dueDate',
      },
      LOW_CONFIDENCE_TAX,
    ],
  },
  {
    // Almost nothing came off the page. Everything a reviewer must supply.
    company: 'engineering',
    seedKey: 'UNREADABLE-SCAN-6616',
    location: 'MAA',
    daysAgo: 34,
    source: 'EMAIL',
    description: 'Unreadable scan',
    stopAt: 'REVIEW_REQUIRED',
    extraction: 'SPARSE',
    findings: [
      {
        code: ValidationCode.MISSING_VENDOR,
        severity: ValidationSeverity.ERROR,
        message: 'No vendor could be identified on the document',
        field: 'vendorName',
      },
      {
        code: ValidationCode.MISSING_INVOICE_NUMBER,
        severity: ValidationSeverity.ERROR,
        message: 'No invoice number could be read',
        field: 'invoiceNumber',
      },
      {
        code: ValidationCode.MISSING_INVOICE_DATE,
        severity: ValidationSeverity.ERROR,
        message: 'No invoice date could be read',
        field: 'invoiceDate',
      },
      {
        code: ValidationCode.MISSING_TOTAL,
        severity: ValidationSeverity.ERROR,
        message: 'No total amount could be read',
        field: 'totalAmount',
      },
      {
        code: ValidationCode.NEGATIVE_AMOUNT,
        severity: ValidationSeverity.ERROR,
        message: 'The extracted total was negative',
        field: 'totalAmount',
        resolved: true,
        resolutionNote: 'Re-keyed from the document; the minus sign was a scan artefact.',
      },
    ],
  },
  {
    // Same vendor and amount as INV-4410, within the duplicate window.
    company: 'engineering',
    vendor: 'ZENITH',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-6617',
    daysAgo: 36,
    dueInDays: 4,
    subtotal: 4_23_729,
    tax: 76_271,
    total: 5_00_000,
    description: 'Structural steel supply',
    stopAt: 'REVIEW_REQUIRED',
    findings: [
      {
        code: ValidationCode.POSSIBLE_DUPLICATE,
        severity: ValidationSeverity.WARNING,
        message: 'Same vendor and amount as INV-4410, raised within a week',
        relatedInvoiceNumbers: ['INV-4410'],
      },
    ],
  },
  {
    // Just arrived from the mailbox; extraction has not run yet.
    company: 'engineering',
    vendor: 'ORION',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-6620',
    daysAgo: 4,
    dueInDays: 26,
    subtotal: 1_69_492,
    tax: 30_508,
    total: 2_00_000,
    description: 'Calibration services',
    stopAt: 'RECEIVED',
  },

  // ── Nova Technologies, so the company switcher is not a dead end ──
  {
    company: 'technologies',
    vendor: 'CLOUDNINE',
    department: 'ENG',
    location: 'HYD',
    invoiceNumber: 'INV-7001',
    daysAgo: 8,
    dueInDays: 14,
    subtotal: 3_38_983,
    tax: 61_017,
    total: 4_00_000,
    description: 'Managed hosting — quarterly',
    stopAt: 'PENDING_APPROVAL',
    findings: [LOW_CONFIDENCE_TAX],
  },
  {
    // Its department has no head on file, so the chain falls back to whoever
    // holds the generic approver role.
    company: 'technologies',
    vendor: 'NIMBUS',
    department: 'OPS',
    location: 'HYD',
    invoiceNumber: 'INV-7002',
    daysAgo: 11,
    dueInDays: 19,
    subtotal: 6_77_966,
    tax: 1_22_034,
    total: 8_00_000,
    description: 'Product design retainer',
    stopAt: 'APPROVED',
  },
  {
    company: 'technologies',
    vendor: 'CLOUDNINE',
    department: 'ENG',
    location: 'BLR',
    invoiceNumber: 'INV-7003',
    daysAgo: 34,
    dueInDays: -4,
    subtotal: 1_27_119,
    tax: 22_881,
    total: 1_50_000,
    description: 'Object storage overage',
    stopAt: 'REVIEW_REQUIRED',
    findings: [LOW_CONFIDENCE_TAX],
  },
];

/**
 * The already-settled invoice, kept separate because it is written as a
 * complete paid chain rather than walked through the pipeline.
 */
export const SETTLED_INVOICE = {
  company: 'engineering',
  vendor: 'ZENITH',
  invoiceNumber: 'INV-7702',
  daysAgo: 20,
  dueInDays: -9,
  paidDaysAgo: 8,
  subtotal: 15_42_373,
  tax: 2_77_627,
  total: 18_20_000,
};
