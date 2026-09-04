/**
 * Domain enumerations for the Elixir Finance Ops platform.
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

/**
 * Display name for a role key.
 *
 * Tenants can define their own roles, whose keys are not in `ROLE_LABELS`, so
 * every screen that prints a role goes through here rather than indexing the
 * map directly and rendering `undefined`.
 */
export function roleLabel(key: string, catalogue?: Readonly<Record<string, string>>): string {
  return (
    catalogue?.[key] ??
    ROLE_LABELS[key as RoleKey] ??
    key
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

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
  MAIL_CONNECTION: 'MAIL_CONNECTION',
  MAIL_INGESTION: 'MAIL_INGESTION',
  AUTH: 'AUTH',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const Currency = {
  INR: 'INR',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

/**
 * Attachment types the extractor can read.
 *
 * Shared rather than repeated so the manual upload endpoint, the shared
 * company mailbox poller and the per-user Outlook connector can never disagree
 * about what is worth storing.
 */
export const SUPPORTED_INVOICE_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export type SupportedInvoiceContentType = (typeof SUPPORTED_INVOICE_CONTENT_TYPES)[number];

/** Mailbox providers a user can connect to pull invoices from. */
export const MailProvider = {
  OUTLOOK: 'OUTLOOK',
} as const;
export type MailProvider = (typeof MailProvider)[keyof typeof MailProvider];
export const MAIL_PROVIDERS = Object.values(MailProvider);

/**
 * Health of a connected mailbox.
 *
 * `REVOKED` covers both a user disconnecting here and Microsoft withdrawing
 * consent at the source; `ERROR` is anything we can retry by reconnecting.
 */
export const MailConnectionStatus = {
  CONNECTED: 'CONNECTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  ERROR: 'ERROR',
} as const;
export type MailConnectionStatus = (typeof MailConnectionStatus)[keyof typeof MailConnectionStatus];
export const MAIL_CONNECTION_STATUSES = Object.values(MailConnectionStatus);

/** Outcome of pulling one email. `SKIPPED` is an expected result, not a fault. */
export const MailIngestionStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;
export type MailIngestionStatus = (typeof MailIngestionStatus)[keyof typeof MailIngestionStatus];
export const MAIL_INGESTION_STATUSES = Object.values(MailIngestionStatus);

/** Outcome of reading one attachment out of a pulled email. */
export const MailAttachmentStatus = {
  QUEUED: 'QUEUED',
  EXTRACTING: 'EXTRACTING',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;
export type MailAttachmentStatus = (typeof MailAttachmentStatus)[keyof typeof MailAttachmentStatus];
export const MAIL_ATTACHMENT_STATUSES = Object.values(MailAttachmentStatus);

/**
 * Why a pulled email produced no invoice.
 *
 * Stored rather than dropped: this is the only way a user can answer "why
 * didn't my invoice come in?" without reading a server log.
 */
export const MailSkipReason = {
  NO_ATTACHMENTS: 'NO_ATTACHMENTS',
  UNSUPPORTED_ATTACHMENTS: 'UNSUPPORTED_ATTACHMENTS',
  SENDER_NOT_ALLOWED: 'SENDER_NOT_ALLOWED',
  SUBJECT_NOT_MATCHED: 'SUBJECT_NOT_MATCHED',
  ATTACHMENT_TOO_LARGE: 'ATTACHMENT_TOO_LARGE',
  COMPANY_ACCESS_LOST: 'COMPANY_ACCESS_LOST',
} as const;
export type MailSkipReason = (typeof MailSkipReason)[keyof typeof MailSkipReason];
export const MAIL_SKIP_REASONS = Object.values(MailSkipReason);

/** Printed verbatim on the Invoice Mailbox screen. */
export const MAIL_SKIP_REASON_LABELS: Record<MailSkipReason, string> = {
  NO_ATTACHMENTS: 'The email carried no attachments',
  UNSUPPORTED_ATTACHMENTS: 'No attachment was a PDF, JPEG or PNG',
  SENDER_NOT_ALLOWED: 'The sender is not on your allow list',
  SUBJECT_NOT_MATCHED: 'The subject matched none of your keywords',
  ATTACHMENT_TOO_LARGE: 'Every attachment was too large to read',
  COMPANY_ACCESS_LOST: 'You no longer have access to the company this would go to',
};

/** How a sync run ended. `PARTIAL` means some emails failed and the rest did not. */
export const MailSyncOutcome = {
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;
export type MailSyncOutcome = (typeof MailSyncOutcome)[keyof typeof MailSyncOutcome];

/** Whether a sync is currently claimed. Doubles as the concurrency lock. */
export const MailSyncState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
} as const;
export type MailSyncState = (typeof MailSyncState)[keyof typeof MailSyncState];

/** Which part of a message a company routing rule matches on. */
export const MailRouteMatch = {
  SENDER: 'SENDER',
  SUBJECT: 'SUBJECT',
  TO: 'TO',
} as const;
export type MailRouteMatch = (typeof MailRouteMatch)[keyof typeof MailRouteMatch];
export const MAIL_ROUTE_MATCHES = Object.values(MailRouteMatch);
