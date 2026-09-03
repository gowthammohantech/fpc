/**
 * Domain enumerations for the Finance Operations platform.
 *
 * These are the single source of truth shared by the API server, the web
 * application and the mobile application. They are declared as const objects
 * plus a derived union type so they can be used both as runtime values
 * (Mongoose enums, Zod enums, UI dropdowns) and as compile-time types.
 */

export const RoleKey = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  FINANCE_EXECUTIVE: 'FINANCE_EXECUTIVE',
  FINANCE_MANAGER: 'FINANCE_MANAGER',
  APPROVER: 'APPROVER',
  CFO: 'CFO',
  PAYROLL_USER: 'PAYROLL_USER',
  AUDITOR: 'AUDITOR',
} as const;
export type RoleKey = (typeof RoleKey)[keyof typeof RoleKey];
export const ROLE_KEYS = Object.values(RoleKey);

export const ROLE_LABELS: Record<RoleKey, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COMPANY_ADMIN: 'Company Admin',
  FINANCE_EXECUTIVE: 'Finance Executive',
  FINANCE_MANAGER: 'Finance Manager',
  APPROVER: 'Approver',
  CFO: 'CFO',
  PAYROLL_USER: 'Payroll User',
  AUDITOR: 'Auditor / Read Only',
};

/** Invoice lifecycle — PRD §14. */
export const InvoiceStatus = {
  RECEIVED: 'RECEIVED',
  EXTRACTING: 'EXTRACTING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  VALIDATED: 'VALIDATED',
  SUBMITTED: 'SUBMITTED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_BATCHED: 'PAYMENT_BATCHED',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAID: 'PAID',
  RECONCILED: 'RECONCILED',
  // Alternative / terminal states
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const INVOICE_STATUSES = Object.values(InvoiceStatus);

/** Statuses that mean the invoice is no longer progressing towards payment. */
export const INVOICE_TERMINAL_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.REJECTED,
  InvoiceStatus.DUPLICATE,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.FAILED,
  InvoiceStatus.RECONCILED,
];

export const InvoiceSource = {
  EMAIL: 'EMAIL',
  UPLOAD: 'UPLOAD',
} as const;
export type InvoiceSource = (typeof InvoiceSource)[keyof typeof InvoiceSource];

/** Payroll batch lifecycle. Mirrors the invoice ladder at batch granularity. */
export const PayrollBatchStatus = {
  DRAFT: 'DRAFT',
  IMPORTED: 'IMPORTED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  VALIDATED: 'VALIDATED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_BATCHED: 'PAYMENT_BATCHED',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAID: 'PAID',
  RECONCILED: 'RECONCILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type PayrollBatchStatus = (typeof PayrollBatchStatus)[keyof typeof PayrollBatchStatus];
export const PAYROLL_BATCH_STATUSES = Object.values(PayrollBatchStatus);

/** Payment batch lifecycle — PRD §22. */
export const PaymentBatchStatus = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  EXPORTED: 'EXPORTED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIALLY_RECONCILED: 'PARTIALLY_RECONCILED',
  RECONCILED: 'RECONCILED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentBatchStatus = (typeof PaymentBatchStatus)[keyof typeof PaymentBatchStatus];
export const PAYMENT_BATCH_STATUSES = Object.values(PaymentBatchStatus);

/** What kind of source produced a payment obligation — PRD §20. */
export const ObligationType = {
  VENDOR: 'VENDOR',
  PAYROLL: 'PAYROLL',
} as const;
export type ObligationType = (typeof ObligationType)[keyof typeof ObligationType];

/** Approval state, used on obligations, invoices and payroll batches. */
export const ApprovalStatus = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ApprovalStepStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SKIPPED: 'SKIPPED',
} as const;
export type ApprovalStepStatus = (typeof ApprovalStepStatus)[keyof typeof ApprovalStepStatus];

export const ApprovalSubjectType = {
  VENDOR_INVOICE: 'VENDOR_INVOICE',
  PAYROLL_BATCH: 'PAYROLL_BATCH',
} as const;
export type ApprovalSubjectType = (typeof ApprovalSubjectType)[keyof typeof ApprovalSubjectType];

export const ApproverType = {
  ROLE: 'ROLE',
  USER: 'USER',
  DEPARTMENT_HEAD: 'DEPARTMENT_HEAD',
} as const;
export type ApproverType = (typeof ApproverType)[keyof typeof ApproverType];

/** Where an obligation sits in the payment pipeline — PRD §20. */
export const PaymentStatus = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  BATCHED: 'BATCHED',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  ON_HOLD: 'ON_HOLD',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** Reconciliation state — PRD §26. */
export const ReconciliationStatus = {
  UNMATCHED: 'UNMATCHED',
  SUGGESTED: 'SUGGESTED',
  MATCHED: 'MATCHED',
  IGNORED: 'IGNORED',
} as const;
export type ReconciliationStatus = (typeof ReconciliationStatus)[keyof typeof ReconciliationStatus];

export const MatchMethod = {
  AUTO_SUGGESTED: 'AUTO_SUGGESTED',
  MANUAL: 'MANUAL',
} as const;
export type MatchMethod = (typeof MatchMethod)[keyof typeof MatchMethod];

export const BankTransactionDirection = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;
export type BankTransactionDirection =
  (typeof BankTransactionDirection)[keyof typeof BankTransactionDirection];

/** Severity of a validation finding — PRD §13. */
export const ValidationSeverity = {
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
} as const;
export type ValidationSeverity = (typeof ValidationSeverity)[keyof typeof ValidationSeverity];

export const ValidationCode = {
  MISSING_VENDOR: 'MISSING_VENDOR',
  MISSING_INVOICE_NUMBER: 'MISSING_INVOICE_NUMBER',
  MISSING_INVOICE_DATE: 'MISSING_INVOICE_DATE',
  MISSING_TOTAL: 'MISSING_TOTAL',
  TOTAL_MISMATCH: 'TOTAL_MISMATCH',
  NEGATIVE_AMOUNT: 'NEGATIVE_AMOUNT',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  EXACT_DUPLICATE: 'EXACT_DUPLICATE',
  LOW_CONFIDENCE_FIELD: 'LOW_CONFIDENCE_FIELD',
  MISSING_VENDOR_BANK_DETAILS: 'MISSING_VENDOR_BANK_DETAILS',
  DUE_DATE_BEFORE_INVOICE_DATE: 'DUE_DATE_BEFORE_INVOICE_DATE',
} as const;
export type ValidationCode = (typeof ValidationCode)[keyof typeof ValidationCode];

export const VendorStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const BankFileFormat = {
  HDFC: 'HDFC',
  ICICI: 'ICICI',
  GENERIC_CSV: 'GENERIC_CSV',
  GENERIC_XLSX: 'GENERIC_XLSX',
} as const;
export type BankFileFormat = (typeof BankFileFormat)[keyof typeof BankFileFormat];

export const StatementImportStatus = {
  UPLOADED: 'UPLOADED',
  PARSING: 'PARSING',
  PARSED: 'PARSED',
  FAILED: 'FAILED',
} as const;
export type StatementImportStatus =
  (typeof StatementImportStatus)[keyof typeof StatementImportStatus];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

/** Notification types — PRD §34. */
export const NotificationType = {
  INVOICE_AWAITING_APPROVAL: 'INVOICE_AWAITING_APPROVAL',
  INVOICE_APPROVED: 'INVOICE_APPROVED',
  INVOICE_REJECTED: 'INVOICE_REJECTED',
  INVOICE_DUPLICATE_DETECTED: 'INVOICE_DUPLICATE_DETECTED',
  PAYROLL_AWAITING_APPROVAL: 'PAYROLL_AWAITING_APPROVAL',
  PAYROLL_APPROVED: 'PAYROLL_APPROVED',
  PAYROLL_REJECTED: 'PAYROLL_REJECTED',
  PAYMENT_BATCH_GENERATED: 'PAYMENT_BATCH_GENERATED',
  PAYMENT_BATCH_EXPORTED: 'PAYMENT_BATCH_EXPORTED',
  RECONCILIATION_UNMATCHED: 'RECONCILIATION_UNMATCHED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  VENDOR_PAYMENT_COMPLETED: 'VENDOR_PAYMENT_COMPLETED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const EntityType = {
  TENANT: 'TENANT',
  COMPANY: 'COMPANY',
  LOCATION: 'LOCATION',
  DEPARTMENT: 'DEPARTMENT',
  USER: 'USER',
  ROLE: 'ROLE',
  VENDOR: 'VENDOR',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  INVOICE: 'INVOICE',
  PAYROLL_BATCH: 'PAYROLL_BATCH',
  PAYROLL_EMPLOYEE: 'PAYROLL_EMPLOYEE',
  PAYMENT_OBLIGATION: 'PAYMENT_OBLIGATION',
  APPROVAL_RULE: 'APPROVAL_RULE',
  APPROVAL_REQUEST: 'APPROVAL_REQUEST',
  PAYMENT_BATCH: 'PAYMENT_BATCH',
  BANK_STATEMENT: 'BANK_STATEMENT',
  BANK_TRANSACTION: 'BANK_TRANSACTION',
  RECONCILIATION: 'RECONCILIATION',
  AUTH: 'AUTH',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const Currency = {
  INR: 'INR',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
