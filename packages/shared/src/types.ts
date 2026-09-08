import type {
  ApprovalStatus,
  ApprovalStepStatus,
  ApprovalSubjectType,
  ApproverType,
  BankFileFormat,
  BankTransactionDirection,
  BusinessUnitKind,
  Currency,
  EntityType,
  FinanceRequestAction,
  FinanceRequestPriority,
  FinanceRequestStatus,
  InvoiceSource,
  InvoiceStatus,
  MailAttachmentStatus,
  MailConnectionStatus,
  MailIngestionStatus,
  MailProvider,
  MailRouteMatch,
  MailSkipReason,
  MailSyncOutcome,
  MailSyncState,
  MatchMethod,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  ObligationType,
  PaymentBatchStatus,
  PaymentStatus,
  PayrollBatchStatus,
  ReconciliationStatus,
  RoleKey,
  StatementImportStatus,
  TdsSection,
  ValidationCode,
  ValidationSeverity,
  VendorStatus,
} from './enums.js';
import type { Permission } from './permissions.js';

/** Every id crosses the wire as a string. */
export type Id = string;
/** ISO-8601 timestamp string. */
export type IsoDate = string;

export interface Timestamps {
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/**
 * The organisation axes a business document is filed under, and the same
 * vocabulary a user's access is granted in.
 *
 * Every axis is denormalised onto the document rather than walked through
 * parent links, so scoping a query stays a flat `$in` on an indexed field.
 */
export interface OrgDimensions {
  groupId?: Id;
  regionId?: Id;
  verticalId?: Id;
  businessUnitId?: Id;
  locationId?: Id;
  departmentId?: Id;
}

/**
 * The org axes a principal is restricted to.
 *
 * An empty array on any axis means "unrestricted on that axis" — the same
 * convention `companyIds` has always used for platform and company admins.
 */
export interface OrgScope {
  companyIds: Id[];
  groupIds: Id[];
  regionIds: Id[];
  verticalIds: Id[];
  businessUnitIds: Id[];
  locationIds: Id[];
  departmentIds: Id[];
}

export interface Principal extends OrgScope {
  userId: Id;
  tenantId: Id;
  email: string;
  name: string;
  /** Built-in role keys (PRD §7) and the tenant's own, mixed freely. */
  roleKeys: string[];
  permissions: Permission[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: Principal;
}

// ── Organisation ────────────────────────────────────────────

export interface Tenant extends Timestamps {
  id: Id;
  name: string;
  slug: string;
  active: boolean;
}

export interface Company extends Timestamps {
  id: Id;
  tenantId: Id;
  /** The group this legal entity belongs to, when the tenant uses groups. */
  groupId?: Id;
  name: string;
  legalName?: string;
  gstin?: string;
  cin?: string;
  invoiceInboxAddress?: string;
  baseCurrency: Currency;
  active: boolean;
}

/**
 * A group of companies. Sits above the legal entity, so it is scoped to the
 * tenant rather than to a company.
 */
export interface Group extends Timestamps {
  id: Id;
  tenantId: Id;
  name: string;
  code: string;
  active: boolean;
}

export interface Region extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  name: string;
  code: string;
  active: boolean;
}

export interface Vertical extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  name: string;
  code: string;
  /** Resolved by VERTICAL_HEAD approval steps, mirroring Department. */
  headUserId?: Id;
  active: boolean;
}

export interface BusinessUnit extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  verticalId: Id;
  name: string;
  code: string;
  /** CLASSIFIED units are invisible unless a user is granted them by name. */
  kind: BusinessUnitKind;
  active: boolean;
}

export interface Location extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  name: string;
  code: string;
  city?: string;
  state?: string;
  active: boolean;
}

export interface Department extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  /** The vertical a department reports into, when the tenant uses verticals. */
  verticalId?: Id;
  name: string;
  code: string;
  headUserId?: Id;
  active: boolean;
}

export interface User extends Timestamps, OrgScope {
  id: Id;
  tenantId: Id;
  name: string;
  email: string;
  roleKeys: string[];
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  lastLoginAt?: IsoDate;
}

export interface Vendor extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  code: string;
  name: string;
  email?: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  /** Whether TDS is withheld from this vendor's invoices by default. */
  tdsApplicable: boolean;
  tdsSection?: TdsSection;
  /** Integer basis points: 10% is 1000. See `money.ts`. */
  tdsRateBasisPoints?: number;
  bankAccountNumber?: string;
  ifsc?: string;
  beneficiaryName?: string;
  paymentTermsDays: number;
  status: VendorStatus;
  notes?: string;
}

export interface BankAccount extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  label: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  /** Minor units. Updated from the latest imported statement. */
  currentBalance: number;
  balanceAsOf?: IsoDate;
  bankFileFormat: BankFileFormat;
  active: boolean;
}

// ── Extraction & validation ─────────────────────────────────

export interface ExtractedField<T = string> {
  value: T | null;
  confidence: number;
  /** True once a human has edited the machine-extracted value. */
  edited?: boolean;
  source?: 'OCR' | 'MANUAL' | 'VENDOR_MASTER';
}

export interface ExtractionResult {
  fields: Record<string, ExtractedField<string | number>>;
  lineItems: ExtractedLineItem[];
  rawText?: string;
  provider: string;
  model?: string;
  extractedAt: IsoDate;
  /** Mean confidence across extracted fields. */
  overallConfidence: number;
}

export interface ExtractedLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  hsnSac?: string;
  taxRate?: number;
}

export interface ValidationFinding {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  field?: string;
  /** Populated for duplicate findings. */
  relatedEntityIds?: Id[];
  resolved?: boolean;
  resolvedBy?: Id;
  resolvedAt?: IsoDate;
  resolutionNote?: string;
}

// ── Invoice ─────────────────────────────────────────────────

export interface InvoiceLine {
  description: string;
  quantity?: number;
  unitPrice?: number;
  /** Minor units. */
  amount: number;
  hsnSac?: string;
  taxRate?: number;
}

/** What the accounting team recorded when it verified an invoice. */
export interface InvoiceAccounting {
  verifiedByUserId?: Id;
  verifiedAt?: IsoDate;
  glCode?: string;
  costCentre?: string;
  notes?: string;
}

export interface Invoice extends Timestamps, OrgDimensions {
  id: Id;
  tenantId: Id;
  companyId: Id;
  /** Human-readable identifier, e.g. FIN-INV-2026-000182. Unique per tenant. */
  trackingId: string;
  vendorId?: Id;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceNumberNormalized?: string;
  invoiceDate?: IsoDate;
  dueDate?: IsoDate;
  currency: Currency;
  /** All amounts in minor units. */
  subtotal?: number;
  taxAmount?: number;
  /**
   * GROSS — what the vendor billed. Unchanged by TDS, which is a deduction at
   * payment rather than a change to the bill, so ageing, duplicate detection
   * and the invoice register all keep reading this field.
   */
  totalAmount?: number;
  tdsApplicable: boolean;
  tdsSection?: TdsSection;
  tdsRateBasisPoints?: number;
  /** The taxable value the deduction was calculated on. */
  tdsBaseAmount?: number;
  tdsAmount: number;
  /** `totalAmount - tdsAmount` — what the bank actually pays. */
  netPayable: number;
  accounting?: InvoiceAccounting;
  gstin?: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  documentFileId?: Id;
  documentFileName?: string;
  lines: InvoiceLine[];
  extraction?: ExtractionResult;
  findings: ValidationFinding[];
  approvalRequestId?: Id;
  approvalStatus: ApprovalStatus;
  /** The open trustee escalation, when the invoice has one. */
  financeRequestId?: Id;
  obligationId?: Id;
  paymentBatchId?: Id;
  paidAt?: IsoDate;
  reconciledAt?: IsoDate;
  submittedBy?: Id;
  submittedAt?: IsoDate;
  receivedAt: IsoDate;
  emailMessageId?: string;
  senderEmail?: string;
}

// ── Approvals ───────────────────────────────────────────────

export type ConditionField =
  | 'amount'
  | 'vendorId'
  | 'departmentId'
  | 'locationId'
  | 'regionId'
  | 'verticalId'
  | 'businessUnitId'
  | 'currency'
  | 'employeeCount';

export type ConditionOperator =
  'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'between';

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: unknown;
}

export interface RuleStepDefinition {
  order: number;
  approverType: ApproverType;
  roleKey?: RoleKey;
  userId?: Id;
  label?: string;
  slaHours?: number;
}

export interface ApprovalRule extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  name: string;
  description?: string;
  appliesTo: ApprovalSubjectType;
  priority: number;
  active: boolean;
  conditions: RuleCondition[];
  steps: RuleStepDefinition[];
}

export interface ApprovalStep {
  order: number;
  label: string;
  approverType: ApproverType;
  roleKey?: RoleKey;
  candidateUserIds: Id[];
  status: ApprovalStepStatus;
  actedByUserId?: Id;
  actedByName?: string;
  actedAt?: IsoDate;
  comment?: string;
  slaHours?: number;
  dueAt?: IsoDate;
}

export interface ApprovalRequest extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  subjectType: ApprovalSubjectType;
  subjectId: Id;
  subjectLabel: string;
  /** Minor units. */
  amount: number;
  currency: Currency;
  ruleId?: Id;
  ruleName?: string;
  status: ApprovalStatus;
  currentStepOrder: number;
  steps: ApprovalStep[];
  requestedByUserId: Id;
  requestedAt: IsoDate;
  /** Human-readable identifier, e.g. APR-2026-000921. Unique per tenant. */
  reference: string;
  completedAt?: IsoDate;
}

// ── Trustee escalation ──────────────────────────────────────

export interface FinanceRequestRemark {
  userId: Id;
  userName: string;
  at: IsoDate;
  action?: FinanceRequestAction | 'RAISED' | 'REMARK';
  text: string;
}

/**
 * A request from finance to the trustee team about one invoice.
 *
 * Deliberately not an extra step on the ApprovalRequest chain: it carries a
 * priority and remarks that no approval step has, it can be *returned* rather
 * than only approved or rejected, and a second open chain on the same subject
 * would break the "cancel the request for this subject" lookup.
 */
export interface FinanceRequest extends Timestamps, OrgDimensions {
  id: Id;
  tenantId: Id;
  companyId: Id;
  /** Human-readable identifier, e.g. FR-2026-000829. Unique per tenant. */
  reference: string;
  invoiceId: Id;
  invoiceTrackingId: string;
  subjectLabel: string;
  vendorId?: Id;
  vendorName?: string;
  /** Snapshot in minor units, taken when accounting raised the request. */
  grossAmount: number;
  tdsAmount: number;
  netPayable: number;
  currency: Currency;
  priority: FinanceRequestPriority;
  status: FinanceRequestStatus;
  requestedByUserId: Id;
  requestedByName: string;
  requestedAt: IsoDate;
  remarks: FinanceRequestRemark[];
  decidedByUserId?: Id;
  decidedByName?: string;
  decidedAt?: IsoDate;
  decision?: FinanceRequestAction;
}

// ── Payroll ─────────────────────────────────────────────────

export interface PayrollBatch extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  reference: string;
  periodMonth: number;
  periodYear: number;
  label: string;
  status: PayrollBatchStatus;
  employeeCount: number;
  /** Minor units. */
  totalNetAmount: number;
  currency: Currency;
  locationBreakdown: Array<{
    locationId?: Id;
    locationName: string;
    count: number;
    amount: number;
  }>;
  previousBatchId?: Id;
  previousTotalNetAmount?: number;
  sourceFileId?: Id;
  sourceFileName?: string;
  findings: ValidationFinding[];
  approvalRequestId?: Id;
  approvalStatus: ApprovalStatus;
  paymentBatchId?: Id;
  importedBy?: Id;
  submittedBy?: Id;
  submittedAt?: IsoDate;
  paidAt?: IsoDate;
}

export interface PayrollEmployee extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  payrollBatchId: Id;
  employeeCode: string;
  employeeName: string;
  bankAccountNumber: string;
  ifsc: string;
  /** Minor units. */
  netAmount: number;
  departmentName?: string;
  departmentId?: Id;
  locationName?: string;
  locationId?: Id;
  email?: string;
  obligationId?: Id;
  rowNumber: number;
  findings: ValidationFinding[];
}

// ── Payment pipeline ────────────────────────────────────────

export interface PaymentObligation extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  locationId?: Id;
  departmentId?: Id;
  type: ObligationType;
  /** Invoice id or payroll employee id. */
  sourceId: Id;
  /** Payroll employee obligations also carry their batch. */
  sourceBatchId?: Id;
  reference: string;
  payeeName: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  ifsc: string;
  /** Minor units. */
  amount: number;
  currency: Currency;
  dueDate?: IsoDate;
  approvalStatus: ApprovalStatus;
  paymentStatus: PaymentStatus;
  reconciliationStatus: ReconciliationStatus;
  paymentBatchId?: Id;
  paymentBatchReference?: string;
  bankTransactionId?: Id;
  paidAt?: IsoDate;
  reconciledAt?: IsoDate;
  holdReason?: string;
}

export interface PaymentBatch extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  reference: string;
  paymentDate: IsoDate;
  status: PaymentBatchStatus;
  bankAccountId?: Id;
  bankFileFormat: BankFileFormat;
  itemCount: number;
  /** Minor units. */
  totalAmount: number;
  vendorAmount: number;
  vendorCount: number;
  payrollAmount: number;
  payrollCount: number;
  currency: Currency;
  reconciledAmount: number;
  reconciledCount: number;
  exportFileId?: Id;
  exportFileName?: string;
  exportedAt?: IsoDate;
  exportedBy?: Id;
  createdBy: Id;
  notes?: string;
}

export interface PaymentBatchItem extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  paymentBatchId: Id;
  obligationId: Id;
  type: ObligationType;
  beneficiaryName: string;
  beneficiaryAccount: string;
  ifsc: string;
  amount: number;
  reference: string;
  reconciliationStatus: ReconciliationStatus;
}

// ── Banking & reconciliation ────────────────────────────────

export interface BankStatement extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  bankAccountId: Id;
  fileId?: Id;
  fileName: string;
  status: StatementImportStatus;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  transactionCount: number;
  duplicateCount: number;
  /** Minor units. */
  totalDebit: number;
  totalCredit: number;
  closingBalance?: number;
  uploadedBy: Id;
  error?: string;
}

export interface BankTransaction extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  bankAccountId: Id;
  bankStatementId: Id;
  transactionDate: IsoDate;
  valueDate?: IsoDate;
  description: string;
  reference?: string;
  utr?: string;
  direction: BankTransactionDirection;
  /** Minor units, always positive; `direction` carries the sign. */
  amount: number;
  balance?: number;
  reconciliationStatus: ReconciliationStatus;
  reconciliationId?: Id;
  dedupeHash: string;
}

export interface MatchSignals {
  amountScore: number;
  nameScore: number;
  dateScore: number;
  referenceScore: number;
  amountExact: boolean;
  nameSimilarity: number;
  dayGap: number;
  referenceHit: boolean;
}

export interface Reconciliation extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  bankTransactionId: Id;
  obligationId?: Id;
  paymentBatchId?: Id;
  status: ReconciliationStatus;
  confidence: number;
  method: MatchMethod;
  signals?: MatchSignals;
  confirmedBy?: Id;
  confirmedAt?: IsoDate;
  note?: string;
}

export interface MatchSuggestion {
  obligationId: Id;
  confidence: number;
  signals: MatchSignals;
  obligation: PaymentObligation;
}

// ── Audit & notifications ───────────────────────────────────

export interface AuditEvent {
  id: Id;
  tenantId: Id;
  companyId?: Id;
  event: string;
  entityType: EntityType;
  entityId: Id;
  entityLabel?: string;
  userId?: Id;
  userName?: string;
  timestamp: IsoDate;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string;
  requestId?: string;
}

export interface Notification extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId?: Id;
  userId?: Id;
  toEmail?: string;
  type: NotificationType;
  channel: NotificationChannel;
  status: NotificationStatus;
  title: string;
  body: string;
  link?: string;
  entityType?: EntityType;
  entityId?: Id;
  sentAt?: IsoDate;
  readAt?: IsoDate;
  error?: string;
}

// ── API envelopes ───────────────────────────────────────────

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

// ── Dashboard ───────────────────────────────────────────────

/** One row of a hierarchy breakdown. `id` is null for rows with no unit set. */
export interface OutstandingByUnit {
  id: Id | null;
  count: number;
  amount: number;
}

export interface DashboardSummary {
  /** Minor units. Excludes payroll when the viewer lacks payroll access. */
  totalPayables: number;
  /**
   * Invoice-side figures are GROSS — what was billed. The `payments` and
   * `cash` blocks below are net of TDS, because that is what leaves the bank.
   * The difference between the two is the tax withheld, not a discrepancy.
   */
  invoices: {
    received: number;
    pendingReview: number;
    pendingApproval: number;
    pendingApprovalAmount: number;
    accountingVerification: number;
    accountingVerificationAmount: number;
    trusteeApproval: number;
    trusteeApprovalAmount: number;
    approvedUnpaid: number;
    approvedUnpaidAmount: number;
    overdue: number;
    overdueAmount: number;
  };
  outstandingByVertical: OutstandingByUnit[];
  outstandingByCompany: OutstandingByUnit[];
  payroll: {
    batchId: Id;
    label: string;
    employeeCount: number;
    amount: number;
    previousAmount: number | null;
    difference: number | null;
    status: PayrollBatchStatus;
  } | null;
  /** True when payroll figures were withheld from this response. */
  payrollHidden: boolean;
  payments: {
    readyForPayment: number;
    readyForPaymentCount: number;
    batched: number;
    inFlightBatchAmount: number;
    reconciledToday: number;
    unreconciled: number;
    unreconciledCount: number;
  };
  cash: {
    bankBalance: number;
    approvedVendorPayables: number;
    approvedPayroll: number;
    knownUpcomingOutflow: number;
    /** True when payroll is not included in the outflow figure above. */
    payrollExcluded: boolean;
  };
}

export interface GlobalSearchResult {
  type:
    'INVOICE' | 'VENDOR' | 'PAYMENT_BATCH' | 'PAYROLL_BATCH' | 'PAYROLL_EMPLOYEE' | 'OBLIGATION';
  id: Id;
  title: string;
  subtitle?: string;
  amount?: number;
  status?: string;
  link: string;
}

/** One "send these to that company instead" rule on a mailbox connection. */
export interface MailCompanyRoute {
  match: MailRouteMatch;
  value: string;
  companyId: Id;
}

/**
 * What a connected mailbox is allowed to pull.
 *
 * An empty `senderAllowlist` or `subjectKeywords` means "do not filter on
 * this", not "match nothing" — otherwise a freshly connected mailbox would
 * silently pull nothing at all.
 */
export interface MailSyncRules {
  folder: string;
  senderAllowlist: string[];
  subjectKeywords: string[];
  allowedContentTypes: string[];
  maxMessagesPerSync: number;
  lookbackDays: number;
  companyRoutes: MailCompanyRoute[];
}

/**
 * A user's connected mailbox.
 *
 * Note there are no token fields here: the stored OAuth tokens never leave the
 * server, and the API mapper does not emit them.
 */
export interface MailConnection extends Timestamps {
  id: Id;
  tenantId: Id;
  userId: Id;
  provider: MailProvider;
  accountEmail: string;
  accountName?: string;
  status: MailConnectionStatus;
  statusMessage?: string;
  scopes: string[];
  /** Where pulled invoices land when no routing rule matches. */
  defaultCompanyId: Id;
  rules: MailSyncRules;
  autoSyncEnabled: boolean;
  watermarkAt?: IsoDate;
  lastSyncAt?: IsoDate;
  lastSyncStatus?: MailSyncOutcome;
  lastSyncError?: string;
  syncState: MailSyncState;
  syncStartedAt?: IsoDate;
  syncRunId?: string;
  connectedAt: IsoDate;
  disconnectedAt?: IsoDate;
  totalMessagesSeen: number;
  totalInvoicesCreated: number;
}

/** One attachment on a pulled email, and what became of it. */
export interface MailIngestionAttachment {
  name: string;
  contentType: string;
  size: number;
  status: MailAttachmentStatus;
  skipReason?: string;
  /** The exact `Invoice.emailMessageId` this attachment was ingested under. */
  messageKey?: string;
  invoiceId?: Id;
  error?: string;
  extractionStartedAt?: IsoDate;
  extractionCompletedAt?: IsoDate;
}

/**
 * One email pulled from a connected mailbox.
 *
 * Skipped and failed messages are recorded alongside successful ones — they
 * are the rows that explain why an expected invoice never arrived.
 */
export interface MailIngestion extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  connectionId: Id;
  userId: Id;
  provider: MailProvider;
  providerMessageId: string;
  internetMessageId?: string;
  subject: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: string[];
  receivedAt: IsoDate;
  bodyPreview?: string;
  folderName?: string;
  webLink?: string;
  status: MailIngestionStatus;
  skipReason?: MailSkipReason;
  error?: string;
  attachmentCount: number;
  processedCount: number;
  attachments: MailIngestionAttachment[];
  syncRunId: string;
  startedAt: IsoDate;
  completedAt?: IsoDate;
}

/** What one "Sync now" produced. */
export interface MailSyncSummary {
  syncRunId: string;
  messagesSeen: number;
  invoicesCreated: number;
  skipped: number;
  failed: number;
  outcome: MailSyncOutcome;
  /** The provider had more waiting than this run's cap allowed. */
  hasMore: boolean;
}
