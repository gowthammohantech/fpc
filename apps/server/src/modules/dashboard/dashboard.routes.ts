import { Router } from 'express';
import { Types, type PipelineStage } from 'mongoose';
import {
  InvoiceStatus,
  ObligationType,
  PAYROLL_VISIBILITY_PERMISSION,
  PayrollBatchStatus,
  schemas,
} from '@fpc/shared';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler.js';
import { query, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { applyOrgScope, scopeFilter } from '../../middleware/tenantScope.js';
import { BankAccount } from '../../models/bankAccount.model.js';
import { BankTransaction } from '../../models/banking.model.js';
import { Invoice } from '../../models/invoice.model.js';
import { PaymentBatch } from '../../models/paymentBatch.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { PayrollBatch, PayrollEmployee } from '../../models/payroll.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { escapeRegex } from '../organization/crudFactory.js';

export const dashboardRouter: Router = Router();

const OPEN_INVOICE_STATUSES = [
  InvoiceStatus.APPROVED,
  InvoiceStatus.PAYMENT_PENDING,
  InvoiceStatus.PAYMENT_BATCHED,
  InvoiceStatus.PAYMENT_PROCESSING,
];

/**
 * Everything still owed, for the hierarchy breakdowns — wider than
 * OPEN_INVOICE_STATUSES because an invoice with an approver or with accounting
 * is outstanding too.
 */
const OUTSTANDING_INVOICE_STATUSES = [
  InvoiceStatus.PENDING_APPROVAL,
  InvoiceStatus.ACCOUNTING_VERIFICATION,
  InvoiceStatus.TRUSTEE_APPROVAL,
  ...OPEN_INVOICE_STATUSES,
];

/**
 * The CFO dashboard — PRD §30 and §31.
 *
 * Deliberately operational rather than BI: these are the numbers that answer
 * the §45 questions ("how much do we owe?", "what is ready to pay?", "what
 * remains unreconciled?") without anyone calling the finance team.
 */
dashboardRouter.get(
  '/',
  requirePermission('dashboard:read'),
  validateQuery(schemas.scopeQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.scopeQuery>(req);
    const base = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    applyOrgScope(principal, base, q);
    const canSeePayroll = principal.permissions.includes(PAYROLL_VISIBILITY_PERMISSION);

    // Bank accounts and bank transactions belong to a company, not to a
    // vertical, so narrowing them on org axes they do not carry would return
    // nothing. Cash is a company-level figure by nature.
    const companyBase = scopeFilter(principal, q.companyId) as Record<string, unknown>;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      invoiceStats,
      received,
      pendingReview,
      overdue,
      payroll,
      obligationStats,
      batchStats,
      reconciledToday,
      unreconciled,
      bankBalance,
      byVertical,
      byCompany,
    ] = await Promise.all([
      sumBy(Invoice, base, 'status', '$totalAmount'),
      Invoice.countDocuments(base),
      Invoice.countDocuments({
        ...base,
        status: { $in: [InvoiceStatus.REVIEW_REQUIRED, InvoiceStatus.FAILED] },
      }),
      aggregateOne(
        Invoice,
        {
          ...base,
          status: { $in: OPEN_INVOICE_STATUSES },
          dueDate: { $lt: startOfToday },
        },
        '$totalAmount',
      ),
      canSeePayroll ? latestPayroll(base) : null,
      sumBy(PaymentObligation, { ...base, approvalStatus: 'APPROVED' }, 'paymentStatus', '$amount'),
      aggregateOne(
        PaymentBatch,
        {
          ...companyBase,
          status: { $in: ['EXPORTED', 'PROCESSING', 'PARTIALLY_RECONCILED'] },
        },
        '$totalAmount',
      ),
      aggregateOne(
        BankTransaction,
        {
          ...companyBase,
          direction: 'DEBIT',
          reconciliationStatus: 'MATCHED',
          updatedAt: { $gte: startOfToday },
        },
        '$amount',
      ),
      aggregateOne(
        BankTransaction,
        {
          ...companyBase,
          direction: 'DEBIT',
          reconciliationStatus: { $in: ['UNMATCHED', 'SUGGESTED'] },
        },
        '$amount',
      ),
      aggregateOne(BankAccount, { ...companyBase, active: true }, '$currentBalance'),
      outstandingBy(base, '$verticalId'),
      outstandingBy(base, '$companyId'),
    ]);

    const pendingApproval = invoiceStats.get(InvoiceStatus.PENDING_APPROVAL) ?? empty();
    const approvedUnpaid = OPEN_INVOICE_STATUSES.reduce((sum, status) => {
      const entry = invoiceStats.get(status) ?? empty();
      return { count: sum.count + entry.count, amount: sum.amount + entry.amount };
    }, empty());

    // The two new stages: business-approved, not yet cleared to pay. Reported
    // separately so "approved and unpaid" keeps meaning "ready or in flight".
    const inAccounting = invoiceStats.get(InvoiceStatus.ACCOUNTING_VERIFICATION) ?? empty();
    const withTrustee = invoiceStats.get(InvoiceStatus.TRUSTEE_APPROVAL) ?? empty();

    const readyForPayment = obligationStats.get('QUEUED') ?? empty();
    const batched = obligationStats.get('BATCHED') ?? empty();
    const processing = obligationStats.get('PROCESSING') ?? empty();

    // Cash visibility (PRD §31): what we know is going out, against what we
    // hold. Payroll is included in the outflow only for those allowed to see
    // it; the response says so rather than quietly under-reporting.
    // Gross above (what was billed), net here (what will leave the bank).
    const approvedVendorPayables = approvedUnpaid.amount;
    const approvedPayroll = canSeePayroll ? (payroll?.pendingPaymentAmount ?? 0) : 0;

    res.json({
      totalPayables: approvedUnpaid.amount + approvedPayroll,
      invoices: {
        received,
        pendingReview,
        pendingApproval: pendingApproval.count,
        pendingApprovalAmount: pendingApproval.amount,
        accountingVerification: inAccounting.count,
        accountingVerificationAmount: inAccounting.amount,
        trusteeApproval: withTrustee.count,
        trusteeApprovalAmount: withTrustee.amount,
        approvedUnpaid: approvedUnpaid.count,
        approvedUnpaidAmount: approvedUnpaid.amount,
        overdue: overdue.count,
        overdueAmount: overdue.amount,
      },
      outstandingByVertical: byVertical,
      outstandingByCompany: byCompany,
      payroll: payroll?.summary ?? null,
      payrollHidden: !canSeePayroll,
      payments: {
        readyForPayment: readyForPayment.amount,
        readyForPaymentCount: readyForPayment.count,
        batched: batched.amount + processing.amount,
        inFlightBatchAmount: batchStats.amount,
        reconciledToday: reconciledToday.amount,
        unreconciled: unreconciled.amount,
        unreconciledCount: unreconciled.count,
      },
      cash: {
        bankBalance: bankBalance.amount,
        approvedVendorPayables,
        approvedPayroll,
        knownUpcomingOutflow: approvedVendorPayables + approvedPayroll,
        payrollExcluded: !canSeePayroll,
      },
    });
  }),
);

/**
 * Outstanding money grouped by one organisation axis.
 *
 * Answers the "vertical-wise outstanding" and "company-wise outstanding"
 * questions the CFO dashboard is judged on. Rows with no value on the axis are
 * reported as `null` rather than dropped, so the totals still add up.
 */
async function outstandingBy(
  base: Record<string, unknown>,
  field: string,
): Promise<Array<{ id: string | null; count: number; amount: number }>> {
  const rows = await Invoice.aggregate<{
    _id: Types.ObjectId | null;
    count: number;
    amount: number;
  }>([
    { $match: { ...base, status: { $in: OUTSTANDING_INVOICE_STATUSES } } },
    { $group: { _id: field, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    { $sort: { amount: -1 } },
  ]);
  return rows.map((row) => ({
    id: row._id ? String(row._id) : null,
    count: row.count,
    amount: row.amount,
  }));
}

const searchQuery = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Global search — PRD §33.
 *
 * Searches invoice numbers, vendors, batch references, and (only for those
 * permitted) employees. Each result carries the link its screen lives at, so
 * the client does not need to know how to route each type.
 */
dashboardRouter.get(
  '/search',
  requirePermission('dashboard:read'),
  validateQuery(searchQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof searchQuery>(req);
    const base = scopeFilter(principal) as Record<string, unknown>;
    const pattern = { $regex: escapeRegex(q.q), $options: 'i' };
    const perLimit = Math.ceil(q.limit / 3);

    // A bare number is very likely an amount; search on it too.
    const amount = Number(q.q.replace(/[₹,\s]/g, ''));
    const amountFilter =
      Number.isFinite(amount) && amount > 0
        ? {
            totalAmount: {
              $gte: Math.round(amount * 100) - 100,
              $lte: Math.round(amount * 100) + 100,
            },
          }
        : null;

    const canSeePayroll = principal.permissions.includes(PAYROLL_VISIBILITY_PERMISSION);

    const [invoices, vendors, batches, payrollEmployees] = await Promise.all([
      principal.permissions.includes('invoice:read')
        ? Invoice.find({
            ...base,
            $or: [
              // The tracking ID is what a person quotes, so it is the first
              // thing they will paste into search.
              { trackingId: pattern },
              { invoiceNumber: pattern },
              { vendorName: pattern },
              ...(amountFilter ? [amountFilter] : []),
            ],
          })
            .select('trackingId invoiceNumber vendorName totalAmount status')
            .limit(perLimit)
            .lean()
        : [],
      principal.permissions.includes('vendor:read')
        ? Vendor.find({ ...base, $or: [{ name: pattern }, { code: pattern }, { email: pattern }] })
            .select('name code status')
            .limit(perLimit)
            .lean()
        : [],
      principal.permissions.includes('payment_batch:read')
        ? PaymentBatch.find({ ...base, reference: pattern })
            .select('reference totalAmount status paymentDate')
            .limit(perLimit)
            .lean()
        : [],
      canSeePayroll
        ? PayrollEmployee.find({
            ...base,
            $or: [{ employeeCode: pattern }, { employeeName: pattern }],
          })
            .select('employeeCode employeeName netAmount payrollBatchId')
            .limit(perLimit)
            .lean()
        : [],
    ]);

    res.json({
      items: [
        ...invoices.map((invoice) => ({
          type: 'INVOICE' as const,
          id: String(invoice._id),
          title: invoice.invoiceNumber ?? invoice.trackingId,
          subtitle: [invoice.trackingId, invoice.vendorName].filter(Boolean).join(' · '),
          amount: invoice.totalAmount,
          status: invoice.status,
          link: `/invoices/${String(invoice._id)}`,
        })),
        ...vendors.map((vendor) => ({
          type: 'VENDOR' as const,
          id: String(vendor._id),
          title: vendor.name,
          subtitle: vendor.code,
          status: vendor.status,
          link: `/settings/vendors?highlight=${String(vendor._id)}`,
        })),
        ...batches.map((batch) => ({
          type: 'PAYMENT_BATCH' as const,
          id: String(batch._id),
          title: batch.reference,
          subtitle: new Date(batch.paymentDate).toISOString().slice(0, 10),
          amount: batch.totalAmount,
          status: batch.status,
          link: `/payments/batches/${String(batch._id)}`,
        })),
        ...payrollEmployees.map((employee) => ({
          type: 'PAYROLL_EMPLOYEE' as const,
          id: String(employee._id),
          title: employee.employeeName,
          subtitle: employee.employeeCode,
          amount: employee.netAmount,
          link: `/payroll/${String(employee.payrollBatchId)}`,
        })),
      ].slice(0, q.limit),
    });
  }),
);

function empty(): { count: number; amount: number } {
  return { count: 0, amount: 0 };
}

/** Anything with Mongoose's aggregate; the models' generics differ. */
type Aggregatable = { aggregate: (pipeline: PipelineStage[]) => { exec(): Promise<unknown[]> } };

/** Grouped count + sum, used for the invoice and obligation status cards. */
async function sumBy(
  model: Aggregatable,
  match: Record<string, unknown>,
  groupField: string,
  sumField: string,
): Promise<Map<string, { count: number; amount: number }>> {
  const rows = (await model
    .aggregate([
      { $match: match },
      { $group: { _id: `$${groupField}`, count: { $sum: 1 }, amount: { $sum: sumField } } },
    ] as PipelineStage[])
    .exec()) as Array<{ _id: string; count: number; amount: number }>;
  return new Map(rows.map((row) => [row._id, { count: row.count, amount: row.amount ?? 0 }]));
}

async function aggregateOne(
  model: Aggregatable,
  match: Record<string, unknown>,
  sumField: string,
): Promise<{ count: number; amount: number }> {
  const rows = (await model
    .aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: sumField } } },
    ] as PipelineStage[])
    .exec()) as Array<{ count: number; amount: number }>;
  return { count: rows[0]?.count ?? 0, amount: rows[0]?.amount ?? 0 };
}

/** The current payroll run plus how much of it is still to be paid. */
async function latestPayroll(base: Record<string, unknown>) {
  const batch = await PayrollBatch.findOne({
    ...base,
    status: { $nin: [PayrollBatchStatus.CANCELLED, PayrollBatchStatus.REJECTED] },
  })
    .sort({ periodYear: -1, periodMonth: -1 })
    .lean();
  if (!batch) return null;

  const pending = await PaymentObligation.aggregate<{ amount: number }>([
    {
      $match: {
        sourceBatchId: batch._id,
        type: ObligationType.PAYROLL,
        paymentStatus: { $ne: 'PAID' },
      },
    },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]);

  return {
    summary: {
      batchId: String(batch._id),
      label: batch.label,
      employeeCount: batch.employeeCount,
      amount: batch.totalNetAmount,
      previousAmount: batch.previousTotalNetAmount ?? null,
      difference:
        batch.previousTotalNetAmount !== undefined
          ? batch.totalNetAmount - batch.previousTotalNetAmount
          : null,
      status: batch.status,
    },
    pendingPaymentAmount: pending[0]?.amount ?? 0,
  };
}

export type { Types };
