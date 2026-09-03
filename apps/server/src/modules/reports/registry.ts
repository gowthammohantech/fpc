import { Types } from 'mongoose';
import { InvoiceStatus, fromMinor, type Permission } from '@fpc/shared';
import { ApprovalRequest } from '../../models/approvalRequest.model.js';
import { AuditEvent } from '../../models/auditEvent.model.js';
import { BankTransaction, Reconciliation } from '../../models/banking.model.js';
import { Invoice } from '../../models/invoice.model.js';
import { PaymentBatch, PaymentBatchItem } from '../../models/paymentBatch.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { PayrollBatch } from '../../models/payroll.model.js';
import { maskAccount } from '../payments/obligation.service.js';

/**
 * The report catalogue — PRD §32.
 *
 * Each report is one descriptor: the permission it needs, the filters it
 * accepts, its columns, and a function that returns rows. One generic route
 * then serves both the on-screen table and the Excel export, so adding a
 * report is a single object rather than a route plus an exporter.
 */

export interface ReportFilters {
  tenantId: Types.ObjectId;
  companyIds?: Types.ObjectId[];
  companyId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  vendorId?: Types.ObjectId;
}

export type ColumnFormat = 'text' | 'money' | 'date' | 'number' | 'status';

export interface ReportColumn {
  key: string;
  header: string;
  format?: ColumnFormat;
  width?: number;
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  permission: Permission;
  /** Filters this report understands, for the UI to render. */
  filters: Array<'company' | 'location' | 'dateRange' | 'status' | 'vendor'>;
  columns: ReportColumn[];
  run(filters: ReportFilters, limit: number): Promise<Array<Record<string, unknown>>>;
}

/** Applies tenant/company scope consistently to every report query. */
function scope(filters: ReportFilters): Record<string, unknown> {
  const query: Record<string, unknown> = { tenantId: filters.tenantId };
  if (filters.companyId) query.companyId = filters.companyId;
  else if (filters.companyIds?.length) query.companyId = { $in: filters.companyIds };
  if (filters.locationId) query.locationId = filters.locationId;
  return query;
}

function dateRange(filters: ReportFilters): Record<string, unknown> | undefined {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  return {
    ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
    ...(filters.dateTo ? { $lte: filters.dateTo } : {}),
  };
}

const invoiceRegister: ReportDefinition = {
  key: 'invoice-register',
  name: 'Invoice Register',
  description: 'Every invoice received, with its current status and amounts.',
  permission: 'invoice:read',
  filters: ['company', 'location', 'dateRange', 'status', 'vendor'],
  columns: [
    { key: 'invoiceNumber', header: 'Invoice No', width: 18 },
    { key: 'vendorName', header: 'Vendor', width: 30 },
    { key: 'invoiceDate', header: 'Invoice Date', format: 'date', width: 14 },
    { key: 'dueDate', header: 'Due Date', format: 'date', width: 14 },
    { key: 'subtotal', header: 'Subtotal', format: 'money', width: 16 },
    { key: 'taxAmount', header: 'Tax', format: 'money', width: 14 },
    { key: 'totalAmount', header: 'Total', format: 'money', width: 16 },
    { key: 'status', header: 'Status', format: 'status', width: 20 },
    { key: 'source', header: 'Source', width: 12 },
    { key: 'receivedAt', header: 'Received', format: 'date', width: 14 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    const range = dateRange(filters);
    if (range) query.invoiceDate = range;
    if (filters.status) query.status = filters.status;
    if (filters.vendorId) query.vendorId = filters.vendorId;

    return Invoice.find(query).sort({ receivedAt: -1 }).limit(limit).lean();
  },
};

const pendingApproval: ReportDefinition = {
  key: 'pending-approval',
  name: 'Pending Approval Report',
  description: 'What is awaiting approval, and who is holding it.',
  permission: 'approval:read_all',
  filters: ['company', 'dateRange'],
  columns: [
    { key: 'subjectLabel', header: 'Item', width: 36 },
    { key: 'subjectType', header: 'Type', width: 16 },
    { key: 'amount', header: 'Amount', format: 'money', width: 16 },
    { key: 'ruleName', header: 'Rule', width: 30 },
    { key: 'currentApprover', header: 'Waiting On', width: 26 },
    { key: 'currentLevel', header: 'Level', width: 22 },
    { key: 'requestedAt', header: 'Submitted', format: 'date', width: 14 },
    { key: 'ageDays', header: 'Days Waiting', format: 'number', width: 14 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    query.status = { $in: ['PENDING', 'IN_PROGRESS'] };
    const range = dateRange(filters);
    if (range) query.requestedAt = range;

    const requests = await ApprovalRequest.find(query).sort({ requestedAt: 1 }).limit(limit).lean();

    return requests.map((request) => {
      const step = request.steps.find((entry) => entry.order === request.currentStepOrder);
      return {
        ...request,
        currentLevel: step?.label ?? '—',
        // Answers the PRD §45 question "who is holding an approval?".
        currentApprover: step?.label ?? 'Unassigned',
        ageDays: Math.floor((Date.now() - new Date(request.requestedAt).getTime()) / 86_400_000),
      };
    });
  },
};

const approvedInvoices: ReportDefinition = {
  key: 'approved-invoices',
  name: 'Approved Invoice Report',
  description: 'Invoices that have cleared approval, paid or not.',
  permission: 'invoice:read',
  filters: ['company', 'location', 'dateRange', 'vendor'],
  columns: [
    { key: 'invoiceNumber', header: 'Invoice No', width: 18 },
    { key: 'vendorName', header: 'Vendor', width: 30 },
    { key: 'totalAmount', header: 'Amount', format: 'money', width: 16 },
    { key: 'dueDate', header: 'Due Date', format: 'date', width: 14 },
    { key: 'status', header: 'Status', format: 'status', width: 20 },
    { key: 'paidAt', header: 'Paid On', format: 'date', width: 14 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    query.status = {
      $in: [
        InvoiceStatus.APPROVED,
        InvoiceStatus.PAYMENT_PENDING,
        InvoiceStatus.PAYMENT_BATCHED,
        InvoiceStatus.PAYMENT_PROCESSING,
        InvoiceStatus.PAID,
        InvoiceStatus.RECONCILED,
      ],
    };
    const range = dateRange(filters);
    if (range) query.invoiceDate = range;
    if (filters.vendorId) query.vendorId = filters.vendorId;

    return Invoice.find(query).sort({ dueDate: 1 }).limit(limit).lean();
  },
};

const apAgeing: ReportDefinition = {
  key: 'ap-ageing',
  name: 'Accounts Payable Ageing',
  description: 'Open payables bucketed by how overdue they are.',
  permission: 'payable:read',
  filters: ['company', 'location', 'vendor'],
  columns: [
    { key: 'vendorName', header: 'Vendor', width: 30 },
    { key: 'invoiceNumber', header: 'Invoice No', width: 18 },
    { key: 'dueDate', header: 'Due Date', format: 'date', width: 14 },
    { key: 'daysOverdue', header: 'Days Overdue', format: 'number', width: 14 },
    { key: 'bucket', header: 'Bucket', width: 14 },
    { key: 'totalAmount', header: 'Amount', format: 'money', width: 16 },
    { key: 'status', header: 'Status', format: 'status', width: 20 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    query.status = {
      $in: [
        InvoiceStatus.APPROVED,
        InvoiceStatus.PAYMENT_PENDING,
        InvoiceStatus.PAYMENT_BATCHED,
        InvoiceStatus.PAYMENT_PROCESSING,
      ],
    };
    if (filters.vendorId) query.vendorId = filters.vendorId;

    const invoices = await Invoice.find(query).sort({ dueDate: 1 }).limit(limit).lean();

    return invoices.map((invoice) => {
      const daysOverdue = invoice.dueDate
        ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86_400_000)
        : 0;
      return {
        ...invoice,
        daysOverdue: Math.max(0, daysOverdue),
        bucket:
          daysOverdue <= 0 ? 'Not due'
          : daysOverdue <= 30 ? '1-30'
          : daysOverdue <= 60 ? '31-60'
          : daysOverdue <= 90 ? '61-90'
          : '90+',
      };
    });
  },
};

const paymentQueue: ReportDefinition = {
  key: 'payment-queue',
  name: 'Payment Queue',
  description: 'Approved payments waiting to be batched.',
  permission: 'obligation:read',
  filters: ['company', 'location', 'status'],
  columns: [
    { key: 'payeeName', header: 'Payee', width: 30 },
    { key: 'type', header: 'Type', width: 12 },
    { key: 'reference', header: 'Reference', width: 24 },
    { key: 'dueDate', header: 'Due Date', format: 'date', width: 14 },
    { key: 'amount', header: 'Amount', format: 'money', width: 16 },
    { key: 'paymentStatus', header: 'Status', format: 'status', width: 16 },
    { key: 'beneficiaryAccount', header: 'Account', width: 20 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    query.approvalStatus = 'APPROVED';
    query.paymentStatus = filters.status ?? { $in: ['QUEUED', 'PENDING'] };

    const rows = await PaymentObligation.find(query).sort({ dueDate: 1 }).limit(limit).lean();
    return rows.map((row) => ({ ...row, beneficiaryAccount: maskAccount(row.beneficiaryAccount) }));
  },
};

const paymentBatches: ReportDefinition = {
  key: 'payment-batches',
  name: 'Payment Batch Report',
  description: 'Every payment batch, what it contained and how much reconciled.',
  permission: 'payment_batch:read',
  filters: ['company', 'dateRange', 'status'],
  columns: [
    { key: 'reference', header: 'Batch', width: 22 },
    { key: 'paymentDate', header: 'Payment Date', format: 'date', width: 14 },
    { key: 'status', header: 'Status', format: 'status', width: 22 },
    { key: 'itemCount', header: 'Payments', format: 'number', width: 12 },
    { key: 'vendorAmount', header: 'Vendor', format: 'money', width: 18 },
    { key: 'payrollAmount', header: 'Payroll', format: 'money', width: 18 },
    { key: 'totalAmount', header: 'Total', format: 'money', width: 18 },
    { key: 'reconciledAmount', header: 'Reconciled', format: 'money', width: 18 },
    { key: 'exportFileName', header: 'Bank File', width: 26 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    const range = dateRange(filters);
    if (range) query.paymentDate = range;
    if (filters.status) query.status = filters.status;
    return PaymentBatch.find(query).sort({ paymentDate: -1 }).limit(limit).lean();
  },
};

const payrollPayments: ReportDefinition = {
  key: 'payroll-payments',
  name: 'Payroll Payment Report',
  description: 'Payroll batches, their totals and payment status.',
  permission: 'payroll:read',
  filters: ['company', 'dateRange', 'status'],
  columns: [
    { key: 'label', header: 'Payroll', width: 28 },
    { key: 'reference', header: 'Reference', width: 16 },
    { key: 'employeeCount', header: 'Employees', format: 'number', width: 12 },
    { key: 'totalNetAmount', header: 'Net Payroll', format: 'money', width: 20 },
    { key: 'previousTotalNetAmount', header: 'Previous Month', format: 'money', width: 20 },
    { key: 'status', header: 'Status', format: 'status', width: 22 },
    { key: 'paidAt', header: 'Paid On', format: 'date', width: 14 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    if (filters.status) query.status = filters.status;
    return PayrollBatch.find(query).sort({ periodYear: -1, periodMonth: -1 }).limit(limit).lean();
  },
};

const bankTransactions: ReportDefinition = {
  key: 'bank-transactions',
  name: 'Bank Transaction Report',
  description: 'Imported bank transactions and their reconciliation state.',
  permission: 'bank_transaction:read',
  filters: ['company', 'dateRange', 'status'],
  columns: [
    { key: 'transactionDate', header: 'Date', format: 'date', width: 14 },
    { key: 'description', header: 'Narration', width: 40 },
    { key: 'reference', header: 'Reference', width: 20 },
    { key: 'direction', header: 'Dr/Cr', width: 10 },
    { key: 'amount', header: 'Amount', format: 'money', width: 18 },
    { key: 'balance', header: 'Balance', format: 'money', width: 18 },
    { key: 'reconciliationStatus', header: 'Reconciliation', format: 'status', width: 18 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    delete query.locationId; // transactions are not location-scoped
    const range = dateRange(filters);
    if (range) query.transactionDate = range;
    if (filters.status) query.reconciliationStatus = filters.status;
    return BankTransaction.find(query).sort({ transactionDate: -1 }).limit(limit).lean();
  },
};

const reconciliationReport: ReportDefinition = {
  key: 'reconciliation',
  name: 'Reconciliation Report',
  description: 'Confirmed matches, their confidence and who confirmed them.',
  permission: 'reconciliation:read',
  filters: ['company', 'dateRange'],
  columns: [
    { key: 'confirmedAt', header: 'Confirmed', format: 'date', width: 14 },
    { key: 'payeeName', header: 'Payee', width: 30 },
    { key: 'reference', header: 'Reference', width: 22 },
    { key: 'amount', header: 'Amount', format: 'money', width: 18 },
    { key: 'narration', header: 'Bank Narration', width: 40 },
    { key: 'confidence', header: 'Confidence', format: 'number', width: 12 },
    { key: 'method', header: 'Method', width: 18 },
    { key: 'status', header: 'Status', format: 'status', width: 14 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    delete query.locationId;
    const range = dateRange(filters);
    if (range) query.confirmedAt = range;

    const rows = await Reconciliation.find(query).sort({ confirmedAt: -1 }).limit(limit).lean();

    const [obligations, transactions] = await Promise.all([
      PaymentObligation.find({ _id: { $in: rows.map((row) => row.obligationId).filter(Boolean) } }).lean(),
      BankTransaction.find({ _id: { $in: rows.map((row) => row.bankTransactionId) } }).lean(),
    ]);
    const obligationById = new Map(obligations.map((entry) => [String(entry._id), entry]));
    const transactionById = new Map(transactions.map((entry) => [String(entry._id), entry]));

    return rows.map((row) => {
      const obligation = row.obligationId ? obligationById.get(String(row.obligationId)) : undefined;
      const transaction = transactionById.get(String(row.bankTransactionId));
      return {
        ...row,
        payeeName: obligation?.payeeName ?? '—',
        reference: obligation?.reference ?? '—',
        amount: obligation?.amount ?? transaction?.amount ?? 0,
        narration: transaction?.description ?? '',
      };
    });
  },
};

const auditReport: ReportDefinition = {
  key: 'audit',
  name: 'Audit Report',
  description: 'Every recorded action, with who did it and when.',
  permission: 'audit:read',
  filters: ['company', 'dateRange'],
  columns: [
    { key: 'timestamp', header: 'When', format: 'date', width: 20 },
    { key: 'event', header: 'Event', width: 30 },
    { key: 'entityType', header: 'Entity', width: 20 },
    { key: 'entityLabel', header: 'Reference', width: 30 },
    { key: 'userName', header: 'User', width: 24 },
    { key: 'ip', header: 'IP', width: 16 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    delete query.locationId;
    const range = dateRange(filters);
    if (range) query.timestamp = range;
    return AuditEvent.find(query).sort({ timestamp: -1 }).limit(limit).lean();
  },
};

const batchItems: ReportDefinition = {
  key: 'payment-batch-items',
  name: 'Payment Batch Detail',
  description: 'Individual payments inside each batch.',
  permission: 'payment_batch:read',
  filters: ['company', 'dateRange'],
  columns: [
    { key: 'batchReference', header: 'Batch', width: 22 },
    { key: 'beneficiaryName', header: 'Beneficiary', width: 32 },
    { key: 'beneficiaryAccount', header: 'Account', width: 20 },
    { key: 'ifsc', header: 'IFSC', width: 14 },
    { key: 'type', header: 'Type', width: 12 },
    { key: 'amount', header: 'Amount', format: 'money', width: 18 },
    { key: 'reconciliationStatus', header: 'Reconciliation', format: 'status', width: 18 },
  ],
  async run(filters, limit) {
    const query = scope(filters);
    delete query.locationId;

    const items = await PaymentBatchItem.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    const batches = await PaymentBatch.find({
      _id: { $in: [...new Set(items.map((item) => item.paymentBatchId))] },
    })
      .select('_id reference')
      .lean();
    const referenceById = new Map(batches.map((batch) => [String(batch._id), batch.reference]));

    return items.map((item) => ({
      ...item,
      batchReference: referenceById.get(String(item.paymentBatchId)) ?? '',
      beneficiaryAccount: maskAccount(item.beneficiaryAccount),
    }));
  },
};

/** All ten PRD §32 reports, keyed for the generic route. */
export const REPORTS: Record<string, ReportDefinition> = Object.fromEntries(
  [
    invoiceRegister,
    pendingApproval,
    approvedInvoices,
    apAgeing,
    paymentQueue,
    paymentBatches,
    batchItems,
    payrollPayments,
    bankTransactions,
    reconciliationReport,
    auditReport,
  ].map((report) => [report.key, report]),
);

/** Renders a stored value for display or export. */
export function formatCell(value: unknown, format: ColumnFormat | undefined): unknown {
  if (value === null || value === undefined) return '';
  switch (format) {
    case 'money':
      // Exports carry a real number so the spreadsheet can sum the column.
      return typeof value === 'number' ? fromMinor(value) : value;
    case 'date':
      return value instanceof Date ? value : new Date(String(value));
    case 'status':
      return String(value).replace(/_/g, ' ');
    default:
      return typeof value === 'object' ? String(value) : value;
  }
}
