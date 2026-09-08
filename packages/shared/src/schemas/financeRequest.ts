import { z } from 'zod';
import { FINANCE_REQUEST_PRIORITIES, FINANCE_REQUEST_STATUSES } from '../enums.js';
import { objectId, paginationQuery, scopeQuery } from './common.js';

/**
 * The trustee's decision.
 *
 * `RETURN` is the reason finance requests are not approval steps: an approval
 * step can only be approved or rejected, and sending work back to accounting is
 * neither.
 */
export const financeRequestActionRequest = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'RETURN']),
    remarks: z.string().trim().max(1000).optional(),
  })
  .refine((body) => body.action === 'APPROVE' || (body.remarks?.length ?? 0) >= 3, {
    message: 'Rejecting or returning a request needs a remark',
    path: ['remarks'],
  });
export type FinanceRequestActionRequest = z.infer<typeof financeRequestActionRequest>;

export const financeRequestRemarkRequest = z.object({
  remarks: z.string().trim().min(1).max(1000),
});

export const financeRequestPriorityRequest = z.object({
  priority: z.enum(FINANCE_REQUEST_PRIORITIES as [string, ...string[]]),
});

export const financeRequestListQuery = paginationQuery.merge(scopeQuery).extend({
  status: z.enum(FINANCE_REQUEST_STATUSES as [string, ...string[]]).optional(),
  priority: z.enum(FINANCE_REQUEST_PRIORITIES as [string, ...string[]]).optional(),
  invoiceId: objectId.optional(),
  /** `MINE` restricts to requests the caller may decide. */
  scope: z.enum(['MINE', 'ALL']).default('MINE'),
});
export type FinanceRequestListQuery = z.infer<typeof financeRequestListQuery>;
