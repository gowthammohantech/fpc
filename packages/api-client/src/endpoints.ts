import type {
  ApprovalRequest,
  AuditEvent,
  BankAccount,
  BankStatement,
  BankTransaction,
  Company,
  DashboardSummary,
  Department,
  GlobalSearchResult,
  Invoice,
  Location,
  Notification,
  Paginated,
  PaymentBatch,
  PaymentObligation,
  PayrollBatch,
  PayrollEmployee,
  Permission,
  Principal,
  User,
  Vendor,
} from '@fpc/shared';
import type { ApiClient } from './client.js';

/**
 * The API surface as typed functions.
 *
 * Request and response types come from `@fpc/shared`, which the server also
 * uses, so a contract change breaks the web and mobile builds at compile time
 * rather than at runtime.
 */

type Query = Record<string, unknown>;

export const endpoints = (api: ApiClient) => ({
  auth: {
    me: () => api.get<Principal>('/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      api.post<void>('/auth/change-password', { currentPassword, newPassword }),
  },

  dashboard: {
    summary: (query?: Query) => api.get<DashboardSummary>('/dashboard', query),
    search: (q: string) => api.get<{ items: GlobalSearchResult[] }>('/dashboard/search', { q }),
  },

  invoices: {
    list: (query?: Query) => api.get<Paginated<Invoice>>('/invoices', query),
    get: (id: string) => api.get<Invoice>(`/invoices/${id}`),
    documentUrl: (id: string) => `/invoices/${id}/document`,
    upload: (file: File | Blob, companyId: string, fileName?: string) => {
      const form = new FormData();
      form.append('file', file, fileName);
      form.append('companyId', companyId);
      return api.upload<Invoice>('/invoices/upload', form);
    },
    update: (id: string, body: Query) => api.patch<Invoice>(`/invoices/${id}`, body),
    resolveFinding: (
      id: string,
      body: { code: string; resolution: 'KEEP' | 'DUPLICATE'; note: string },
    ) => api.post<Invoice>(`/invoices/${id}/findings/resolve`, body),
    submit: (id: string) =>
      api.post<{ invoice: Invoice; approvalRequestId: string | null; autoApprovedReason?: string }>(
        `/invoices/${id}/submit`,
      ),
    cancel: (id: string, reason: string) => api.post<Invoice>(`/invoices/${id}/cancel`, { reason }),
    reextract: (id: string) => api.post<{ status: string }>(`/invoices/${id}/reextract`),
  },

  approvals: {
    list: (query?: Query) => api.get<Paginated<ApprovalRow>>('/approvals', query),
    get: (id: string) => api.get<ApprovalRequest & { canAct: boolean }>(`/approvals/${id}`),
    act: (id: string, action: 'APPROVE' | 'REJECT', comment?: string) =>
      api.post<ApprovalRequest>(`/approvals/${id}/act`, { action, comment }),
  },

  payables: {
    list: (query?: Query) => api.get<Paginated<Invoice>>('/payables', query),
    summary: (query?: Query) =>
      api.get<Record<string, { count: number; amount: number }>>('/payables/summary', query),
    ageing: (query?: Query) =>
      api.get<Record<string, { count: number; amount: number }>>('/payables/ageing', query),
  },

  payroll: {
    list: (query?: Query) => api.get<Paginated<PayrollBatch>>('/payroll', query),
    get: (id: string) =>
      api.get<
        PayrollBatch & {
          comparison: {
            previousTotalNetAmount: number | null;
            difference: number | null;
            percentChange: number | null;
          };
        }
      >(`/payroll/${id}`),
    employees: (id: string, query?: Query) =>
      api.get<Paginated<PayrollEmployee>>(`/payroll/${id}/employees`, query),
    preview: (file: File | Blob, mapping?: Record<string, string>, fileName?: string) => {
      const form = new FormData();
      form.append('file', file, fileName);
      if (mapping) form.append('mapping', JSON.stringify(mapping));
      return api.upload<PayrollPreview>('/payroll/preview', form);
    },
    import: (input: {
      file: File | Blob;
      fileName?: string;
      companyId: string;
      label: string;
      periodMonth: number;
      periodYear: number;
      mapping?: Record<string, string>;
    }) => {
      const form = new FormData();
      form.append('file', input.file, input.fileName);
      form.append('companyId', input.companyId);
      form.append('label', input.label);
      form.append('periodMonth', String(input.periodMonth));
      form.append('periodYear', String(input.periodYear));
      if (input.mapping) form.append('mapping', JSON.stringify(input.mapping));
      return api.upload<{ batch: PayrollBatch; employeeCount: number; totalNetAmount: number }>(
        '/payroll/import',
        form,
      );
    },
    submit: (id: string) =>
      api.post<{ batch: PayrollBatch; approvalRequestId: string | null }>(`/payroll/${id}/submit`),
    cancel: (id: string) => api.delete<void>(`/payroll/${id}`),
  },

  payments: {
    queue: (query?: Query) =>
      api.get<Paginated<PaymentObligation> & { payrollAggregated?: boolean }>(
        '/payments/queue',
        query,
      ),
    hold: (id: string, hold: boolean, reason?: string) =>
      api.post<PaymentObligation>(`/payments/queue/${id}/hold`, { hold, reason }),
    batches: (query?: Query) => api.get<Paginated<PaymentBatch>>('/payments/batches', query),
    batch: (id: string) =>
      api.get<PaymentBatch & { items: PaymentBatchItemView[]; payrollItemsHidden: number }>(
        `/payments/batches/${id}`,
      ),
    createBatch: (body: Query) => api.post<PaymentBatch>('/payments/batches', body),
    updateBatch: (id: string, body: Query) =>
      api.patch<PaymentBatch>(`/payments/batches/${id}`, body),
    exportBatch: (id: string) =>
      api.post<{
        batch: PaymentBatch;
        file: { id: string; fileName: string };
        downloadUrl: string;
      }>(`/payments/batches/${id}/export`),
    downloadFile: (id: string) => api.download(`/payments/batches/${id}/file`),
  },

  banking: {
    statements: (query?: Query) => api.get<Paginated<BankStatement>>('/banking/statements', query),
    uploadStatement: (input: {
      file: File | Blob;
      fileName?: string;
      companyId: string;
      bankAccountId: string;
      mapping?: Record<string, string>;
    }) => {
      const form = new FormData();
      form.append('file', input.file, input.fileName);
      form.append('companyId', input.companyId);
      form.append('bankAccountId', input.bankAccountId);
      if (input.mapping) form.append('mapping', JSON.stringify(input.mapping));
      return api.upload<StatementImportResult>('/banking/statements', form);
    },
    deleteStatement: (id: string) => api.delete<void>(`/banking/statements/${id}`),
    transactions: (query?: Query) =>
      api.get<Paginated<BankTransaction>>('/banking/transactions', query),
  },

  reconciliation: {
    list: (query?: Query) => api.get<Paginated<ReconciliationRow>>('/reconciliation', query),
    summary: (query?: Query) =>
      api.get<Record<string, { count: number; amount: number }>>('/reconciliation/summary', query),
    candidates: (transactionId: string) =>
      api.get<{ transaction: BankTransaction; candidates: MatchCandidateView[] }>(
        `/reconciliation/transactions/${transactionId}/candidates`,
      ),
    confirm: (bankTransactionId: string, obligationId: string, note?: string) =>
      api.post<{ reconciliationId: string; status: string }>('/reconciliation/confirm', {
        bankTransactionId,
        obligationId,
        note,
      }),
    ignore: (bankTransactionId: string, note: string) =>
      api.post<{ status: string }>('/reconciliation/ignore', { bankTransactionId, note }),
    unmatch: (reconciliationId: string, note: string) =>
      api.post<{ status: string }>('/reconciliation/unmatch', { reconciliationId, note }),
  },

  reports: {
    catalogue: () => api.get<{ items: ReportDescriptor[] }>('/reports'),
    run: (key: string, query?: Query) => api.get<ReportResult>(`/reports/${key}`, query),
    download: (key: string, query?: Query) =>
      api.download(`/reports/${key}`, { ...query, format: 'xlsx' }),
  },

  audit: {
    list: (query?: Query) => api.get<Paginated<AuditEvent>>('/audit', query),
    forEntity: (entityType: string, entityId: string) =>
      api.get<{ items: AuditEvent[] }>(`/audit/entity/${entityType}/${entityId}`),
  },

  notifications: {
    list: (query?: Query) => api.get<Paginated<Notification>>('/notifications', query),
    unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
    markRead: (id: string) => api.post<void>(`/notifications/${id}/read`),
    markAllRead: () => api.post<{ updated: number }>('/notifications/read-all'),
  },

  settings: {
    companies: (query?: Query) => api.get<Paginated<Company>>('/settings/companies', query),
    createCompany: (body: Query) => api.post<Company>('/settings/companies', body),
    updateCompany: (id: string, body: Query) =>
      api.patch<Company>(`/settings/companies/${id}`, body),
    deleteCompany: (id: string) => api.delete<void>(`/settings/companies/${id}`),

    locations: (query?: Query) => api.get<Paginated<Location>>('/settings/locations', query),
    createLocation: (body: Query) => api.post<Location>('/settings/locations', body),
    updateLocation: (id: string, body: Query) =>
      api.patch<Location>(`/settings/locations/${id}`, body),
    deleteLocation: (id: string) => api.delete<void>(`/settings/locations/${id}`),

    departments: (query?: Query) => api.get<Paginated<Department>>('/settings/departments', query),
    createDepartment: (body: Query) => api.post<Department>('/settings/departments', body),
    updateDepartment: (id: string, body: Query) =>
      api.patch<Department>(`/settings/departments/${id}`, body),
    deleteDepartment: (id: string) => api.delete<void>(`/settings/departments/${id}`),

    vendors: (query?: Query) => api.get<Paginated<Vendor>>('/settings/vendors', query),
    createVendor: (body: Query) => api.post<Vendor>('/settings/vendors', body),
    updateVendor: (id: string, body: Query) => api.patch<Vendor>(`/settings/vendors/${id}`, body),
    deleteVendor: (id: string) => api.delete<void>(`/settings/vendors/${id}`),

    users: (query?: Query) => api.get<Paginated<User>>('/settings/users', query),
    createUser: (body: Query) =>
      api.post<User & { inviteToken?: string; inviteUrl?: string }>('/settings/users', body),
    reinviteUser: (id: string) =>
      api.post<{ inviteToken: string; inviteUrl: string }>(`/settings/users/${id}/reinvite`),
    updateUser: (id: string, body: Query) => api.patch<User>(`/settings/users/${id}`, body),
    deleteUser: (id: string) => api.delete<void>(`/settings/users/${id}`),

    roles: () => api.get<{ items: RoleDescriptor[] }>('/settings/roles'),
    createRole: (body: Query) => api.post<RoleDescriptor>('/settings/roles', body),
    updateRole: (id: string, body: Query) =>
      api.patch<RoleDescriptor>(`/settings/roles/${id}`, body),
    deleteRole: (id: string) => api.delete<void>(`/settings/roles/${id}`),

    bankAccounts: (query?: Query) =>
      api.get<Paginated<BankAccount>>('/settings/bank-accounts', query),
    createBankAccount: (body: Query) => api.post<BankAccount>('/settings/bank-accounts', body),
    updateBankAccount: (id: string, body: Query) =>
      api.patch<BankAccount>(`/settings/bank-accounts/${id}`, body),
    deleteBankAccount: (id: string) => api.delete<void>(`/settings/bank-accounts/${id}`),

    approvalRules: (query?: Query) =>
      api.get<Paginated<ApprovalRuleView>>('/settings/approval-rules', query),
    createApprovalRule: (body: Query) =>
      api.post<ApprovalRuleView>('/settings/approval-rules', body),
    updateApprovalRule: (id: string, body: Query) =>
      api.patch<ApprovalRuleView>(`/settings/approval-rules/${id}`, body),
    deleteApprovalRule: (id: string) => api.delete<void>(`/settings/approval-rules/${id}`),
    simulateApprovalRule: (body: Query) =>
      api.post<{ matched: { id: string; name: string; steps: unknown[] } | null; note?: string }>(
        '/settings/approval-rules/simulate',
        body,
      ),
  },
});

export type Endpoints = ReturnType<typeof endpoints>;

// Response shapes that exist only at the API boundary.

export interface PayrollPreview {
  headers: string[];
  mapping: Record<string, string>;
  employeeCount: number;
  totalNetAmount: number;
  locationBreakdown: Array<{ locationName: string; count: number; amount: number }>;
  findings: Array<{ code: string; severity: string; message: string; field?: string }>;
  rejected: Array<{ rowNumber: number; reason: string }>;
  sample: Array<Record<string, unknown>>;
  rowsWithErrors: number;
}

export interface StatementImportResult {
  statement: BankStatement;
  imported: number;
  duplicates: number;
  skipped: Array<{ rowNumber: number; reason: string }>;
  mapping: Record<string, string>;
  suggested: number;
  unmatched: number;
}

export interface PaymentBatchItemView {
  id: string;
  obligationId: string;
  type: 'VENDOR' | 'PAYROLL';
  beneficiaryName: string;
  beneficiaryAccount: string;
  ifsc: string;
  amount: number;
  reference: string;
  reconciliationStatus: string;
}

export interface MatchSignalsView {
  amountScore: number;
  nameScore: number;
  dateScore: number;
  referenceScore: number;
  amountExact: boolean;
  nameSimilarity: number;
  dayGap: number;
  referenceHit: boolean;
}

export interface ReconciliationRow extends BankTransaction {
  match: {
    id: string;
    status: string;
    confidence: number;
    method: string;
    signals?: MatchSignalsView;
    note?: string;
    obligation: PaymentObligation | null;
  } | null;
}

export interface MatchCandidateView {
  obligationId: string;
  confidence: number;
  signals: MatchSignalsView;
  obligation: PaymentObligation | null;
}

/** An approval request plus the waiting/SLA fields the inbox renders. */
export interface ApprovalRow extends ApprovalRequest {
  waitingDays: number;
  dueAt: string | null;
  overdue: boolean;
}

export interface ReportDescriptor {
  key: string;
  name: string;
  description: string;
  filters: string[];
  columns: Array<{ key: string; header: string; format?: string; width?: number }>;
}

export interface ReportResult {
  key: string;
  name: string;
  columns: ReportDescriptor['columns'];
  rowCount: number;
  truncated: boolean;
  rows: Array<Record<string, unknown>>;
}

export interface RoleDescriptor {
  /** Absent for the built-in roles, which are code rather than rows. */
  id?: string;
  key: string;
  label: string;
  description?: string;
  permissions: Permission[];
  permissionCount: number;
  /** Built-in roles cannot be edited or deleted. */
  system: boolean;
  active: boolean;
  /** How many users hold the role — why a delete may be refused. */
  userCount: number;
}

export interface ApprovalRuleView {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  appliesTo: 'VENDOR_INVOICE' | 'PAYROLL_BATCH';
  priority: number;
  active: boolean;
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  steps: Array<{
    order: number;
    approverType: string;
    roleKey?: string;
    userId?: string;
    label?: string;
  }>;
}
