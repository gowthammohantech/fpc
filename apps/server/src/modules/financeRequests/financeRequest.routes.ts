import { Router } from 'express';
import { Types } from 'mongoose';
import { FinanceRequestStatus, schemas, type FinanceRequestAction } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../../middleware/requirePermission.js';
import { applyOrgScope, scopeFilter } from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { FinanceRequest } from '../../models/financeRequest.model.js';
import { Invoice } from '../../models/invoice.model.js';
import { auditContext } from '../audit/audit.service.js';
import * as financeRequestService from './financeRequest.service.js';

export const financeRequestRouter: Router = Router();

/**
 * The trustee inbox.
 *
 * `scope=MINE` (the default) is what a trustee means by "waiting on me": open
 * requests they may actually decide, which excludes any they raised
 * themselves. `scope=ALL` needs `finance_request:read_all` and is what finance
 * and the CFO use to watch the queue.
 *
 * Sorted by priority then age, so a P1 never sits behind a pile of P2s.
 */
financeRequestRouter.get(
  '/',
  requireAnyPermission('finance_request:read', 'finance_request:read_all'),
  validateQuery(schemas.financeRequestListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.financeRequestListQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    applyOrgScope(principal, filter, q);
    if (q.status) filter.status = q.status;
    if (q.priority) filter.priority = q.priority;
    if (q.invoiceId) filter.invoiceId = new Types.ObjectId(q.invoiceId);

    if (q.scope === 'MINE') {
      if (!principal.permissions.includes('finance_request:act')) {
        throw ApiError.forbidden('Only a trustee has a decision queue');
      }
      filter.status = q.status ?? FinanceRequestStatus.PENDING;
      // You cannot decide what you raised, so it does not belong in your queue.
      filter.requestedByUserId = { $ne: principal.userId };
    } else if (!principal.permissions.includes('finance_request:read_all')) {
      throw ApiError.forbidden('Viewing all trustee requests requires finance_request:read_all');
    }

    res.json(
      await paginate(
        FinanceRequest,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          // P1 before P2, then oldest first.
          defaultSort: { priority: 1, requestedAt: 1 },
        },
        (doc) => toApi(doc),
      ),
    );
  }),
);

financeRequestRouter.get(
  '/:id',
  requireAnyPermission('finance_request:read', 'finance_request:read_all'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const request = await FinanceRequest.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    }).lean();
    if (!request) throw ApiError.notFound('Trustee request');

    res.json({
      ...toApi(request),
      // Lets the client offer the decision buttons only when they will work.
      canAct:
        request.status === FinanceRequestStatus.PENDING &&
        principal.permissions.includes('finance_request:act') &&
        !request.requestedByUserId.equals(principal.userId),
    });
  }),
);

/** Approve, reject or return an escalation. */
financeRequestRouter.post(
  '/:id/act',
  requirePermission('finance_request:act'),
  validateBody(schemas.financeRequestActionRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const body = req.body as schemas.FinanceRequestActionRequest;

    const request = await FinanceRequest.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    });
    if (!request) throw ApiError.notFound('Trustee request');

    const invoice = await Invoice.findById(request.invoiceId);
    if (!invoice) throw ApiError.notFound('Invoice');

    await financeRequestService.decide(
      {
        request,
        invoice,
        action: body.action as FinanceRequestAction,
        remarks: body.remarks,
        actedByUserId: principal.userId,
        actedByName: principal.name,
      },
      auditContext(req),
    );

    const fresh = await FinanceRequest.findById(request._id).lean();
    res.json({ request: toApi(fresh), invoiceStatus: invoice.status });
  }),
);

/**
 * Adds a remark without deciding.
 *
 * Available to anyone who can see the request, so finance can answer a
 * trustee's question in the thread rather than by email.
 */
financeRequestRouter.post(
  '/:id/remarks',
  requireAnyPermission('finance_request:read', 'finance_request:read_all'),
  validateBody(schemas.financeRequestRemarkRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const { remarks } = req.body as { remarks: string };

    const request = await FinanceRequest.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    });
    if (!request) throw ApiError.notFound('Trustee request');
    if (request.status !== FinanceRequestStatus.PENDING) {
      throw ApiError.conflict('This request has been decided; its remarks are now a record');
    }

    request.remarks.push({
      userId: principal.userId,
      userName: principal.name,
      at: new Date(),
      action: 'REMARK',
      text: remarks,
    });
    await request.save();

    res.json(toApi(request.toObject()));
  }),
);

/** Raises or lowers the urgency of an open request. */
financeRequestRouter.patch(
  '/:id/priority',
  requirePermission('finance_request:act'),
  validateBody(schemas.financeRequestPriorityRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const { priority } = req.body as { priority: 'P1' | 'P2' };

    const request = await FinanceRequest.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    });
    if (!request) throw ApiError.notFound('Trustee request');
    if (request.status !== FinanceRequestStatus.PENDING) {
      throw ApiError.conflict('This request has already been decided');
    }

    request.priority = priority;
    await request.save();
    res.json(toApi(request.toObject()));
  }),
);

function objectId(value: string | undefined): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid id');
  return new Types.ObjectId(value);
}
