import type {
  ApprovalStatus,
  ApprovalStepStatus,
  ApprovalSubjectType,
  ApproverType,
  BankFileFormat,
  BankTransactionDirection,
  Currency,
  EntityType,
  InvoiceSource,
  InvoiceStatus,
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

export interface Principal {
  userId: Id;
  tenantId: Id;
  email: string;
  name: string;
  roleKeys: RoleKey[];
  permissions: Permission[];
  /** Companies this user may act within. Empty means all companies in tenant. */
  companyIds: Id[];
  locationIds: Id[];
  departmentIds: Id[];
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
  name: string;
  legalName?: string;
  gstin?: string;
  cin?: string;
  invoiceInboxAddress?: string;
  baseCurrency: Currency;
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
  name: string;
  code: string;
  headUserId?: Id;
  active: boolean;
}

export interface User extends Timestamps {
  id: Id;
  tenantId: Id;
  name: string;
  email: string;
  roleKeys: RoleKey[];
  companyIds: Id[];
  locationIds: Id[];
  departmentIds: Id[];
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

export interface Invoice extends Timestamps {
  id: Id;
  tenantId: Id;
  companyId: Id;
  locationId?: Id;
  departmentId?: Id;
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
  totalAmount?: number;
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
  | 'currency'
  | 'employeeCount';

export type ConditionOperator =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'between';

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
  completedAt?: IsoDate;
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
  locationBreakdown: Array<{ locationId?: Id; locationName: string; count: number; amount: number }>;
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

export interface DashboardSummary {
  totalPayables: number;
  invoices: {
    received: number;
    pendingReview: number;
    pendingApproval: number;
    pendingApprovalAmount: number;
    approvedUnpaid: number;
    approvedUnpaidAmount: number;
    overdue: number;
    overdueAmount: number;
  };
  payroll: {
    batchId?: Id;
    label?: string;
    employeeCount: number;
    amount: number;
    status?: PayrollBatchStatus;
  } | null;
  payments: {
    readyForPayment: number;
    batched: number;
    reconciledToday: number;
    unreconciled: number;
  };
  cash: {
    bankBalance: number;
    approvedVendorPayables: number;
    approvedPayroll: number;
    knownUpcomingOutflow: number;
  };
}

export interface GlobalSearchResult {
  type: 'INVOICE' | 'VENDOR' | 'PAYMENT_BATCH' | 'PAYROLL_BATCH' | 'PAYROLL_EMPLOYEE' | 'OBLIGATION';
  id: Id;
  title: string;
  subtitle?: string;
  amount?: number;
  status?: string;
  link: string;
}
