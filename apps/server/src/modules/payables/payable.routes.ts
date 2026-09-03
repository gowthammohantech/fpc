import { Router } from 'express';
import { Types } from 'mongoose';
import { InvoiceStatus, schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { paginate } from '../../core/paginate.js';
import { query, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { applyLocationScope, scopeFilter } from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { Invoice } from '../../models/invoice.model.js';

export const payableRouter: Router = Router();

/** Invoices that represent money still owed — everything approved but unpaid. */
const OPEN_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PENDING_APPROVAL,
  InvoiceStatus.APPROVED,
  InvoiceStatus.PAYMENT_PENDING,
  InvoiceStatus.PAYMENT_BATCHED,
  InvoiceStatus.PAYMENT_PROCESSING,
];

/**
 * Accounts payable — PRD §16.
 *
 * Approved invoices land here automatically; the views are the ones the PRD
 * lists (all, due today, due this week, overdue, approved, payment pending,
 * paid), each expressed as a filter over the same collection.
 */
payableRouter.get(
  '/',
  requirePermission('payable:read'),
  validateQuery(schemas.payableListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.payableListQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    applyLocationScope(principal, filter, q.locationId);
    if (q.vendorId) filter.vendorId = new Types.ObjectId(q.vendorId);
    Object.assign(filter, viewFilter(q.view));

    res.json(
      await paginate(
        Invoice,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          defaultSort: { dueDate: 1 },
        },
        toApi,
      ),
    );
  }),
);

/** Counts and totals per view, so the tabs can show badges without N queries. */
payableRouter.get(
  '/summary',
  requirePermission('payable:read'),
  validateQuery(schemas.scopeQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.scopeQuery>(req);
    const base = scopeFilter(principal, q.companyId) as Record<string, unknown>;

    const views: Array<schemas.PayableListQuery['view']> = [
      'ALL',
      'DUE_TODAY',
      'DUE_THIS_WEEK',
      'OVERDUE',
      'APPROVED',
      'PAYMENT_PENDING',
      'PAID',
    ];

    const summary = await Promise.all(
      views.map(async (view) => {
        const [result] = await Invoice.aggregate<{ count: number; amount: number }>([
          { $match: { ...base, ...viewFilter(view) } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
        ]);
        return [view, { count: result?.count ?? 0, amount: result?.amount ?? 0 }] as const;
      }),
    );

    res.json(Object.fromEntries(summary));
  }),
);

/** Ageing buckets — the standard AP ageing report shape (PRD §32.4). */
payableRouter.get(
  '/ageing',
  requirePermission('payable:read'),
  validateQuery(schemas.scopeQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.scopeQuery>(req);
    const filter = { ...scopeFilter(principal, q.companyId), status: { $in: OPEN_STATUSES } };

    const buckets = await Invoice.aggregate<{
      _id: string;
      count: number;
      amount: number;
    }>([
      { $match: filter },
      {
        $addFields: {
          daysOverdue: {
            $divide: [
              { $subtract: [new Date(), { $ifNull: ['$dueDate', new Date()] }] },
              86_400_000,
            ],
          },
        },
      },
      {
        $addFields: {
          bucket: {
            $switch: {
              branches: [
                { case: { $lte: ['$daysOverdue', 0] }, then: 'NOT_DUE' },
                { case: { $lte: ['$daysOverdue', 30] }, then: '1_30' },
                { case: { $lte: ['$daysOverdue', 60] }, then: '31_60' },
                { case: { $lte: ['$daysOverdue', 90] }, then: '61_90' },
              ],
              default: '90_PLUS',
            },
          },
        },
      },
      { $group: { _id: '$bucket', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]);

    const empty = { count: 0, amount: 0 };
    const byBucket = Object.fromEntries(
      buckets.map((entry) => [entry._id, { count: entry.count, amount: entry.amount }]),
    );

    res.json({
      NOT_DUE: byBucket.NOT_DUE ?? empty,
      '1_30': byBucket['1_30'] ?? empty,
      '31_60': byBucket['31_60'] ?? empty,
      '61_90': byBucket['61_90'] ?? empty,
      '90_PLUS': byBucket['90_PLUS'] ?? empty,
      total: buckets.reduce(
        (sum, entry) => ({ count: sum.count + entry.count, amount: sum.amount + entry.amount }),
        empty,
      ),
    });
  }),
);

function viewFilter(view: schemas.PayableListQuery['view'] | undefined): Record<string, unknown> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  switch (view) {
    case 'DUE_TODAY':
      return { status: { $in: OPEN_STATUSES }, dueDate: { $gte: startOfToday, $lte: endOfToday } };
    case 'DUE_THIS_WEEK':
      return { status: { $in: OPEN_STATUSES }, dueDate: { $gte: startOfToday, $lte: endOfWeek } };
    case 'OVERDUE':
      return { status: { $in: OPEN_STATUSES }, dueDate: { $lt: startOfToday } };
    case 'APPROVED':
      return { status: InvoiceStatus.APPROVED };
    case 'PAYMENT_PENDING':
      return {
        status: {
          $in: [
            InvoiceStatus.PAYMENT_PENDING,
            InvoiceStatus.PAYMENT_BATCHED,
            InvoiceStatus.PAYMENT_PROCESSING,
          ],
        },
      };
    case 'PAID':
      return { status: { $in: [InvoiceStatus.PAID, InvoiceStatus.RECONCILED] } };
    default:
      return { status: { $in: [...OPEN_STATUSES, InvoiceStatus.PAID, InvoiceStatus.RECONCILED] } };
  }
}
