import { Router } from 'express';
import { Types } from 'mongoose';
import { ApprovalStatus, schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../../middleware/requirePermission.js';
import { scopeFilter } from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { ApprovalRequest, type ApprovalRequestDoc } from '../../models/approvalRequest.model.js';
import { ApprovalRule } from '../../models/approvalRule.model.js';
import { auditContext } from '../audit/audit.service.js';
import * as approvalService from './approval.service.js';
import { onApprovalDecided } from './approval.dispatcher.js';
import { crudRouter } from '../organization/crudFactory.js';

export const approvalRouter: Router = Router();

/**
 * The approvals inbox — PRD §36 `/approvals`.
 *
 * `scope=MINE` (the default) restricts to requests whose *currently active*
 * step lists the caller as a candidate, which is what an approver means by
 * "waiting on me". `scope=ALL` needs the broader `approval:read_all`
 * permission and is what the CFO uses to see who is holding an approval.
 */
approvalRouter.get(
  '/',
  requireAnyPermission('approval:read', 'approval:read_all'),
  validateQuery(schemas.approvalListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.approvalListQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    if (q.subjectType) filter.subjectType = q.subjectType;
    if (q.status) filter.status = q.status;

    if (q.scope === 'MINE') {
      filter.status = q.status ?? { $in: [ApprovalStatus.PENDING, ApprovalStatus.IN_PROGRESS] };
      filter.steps = {
        $elemMatch: { status: 'ACTIVE', candidateUserIds: principal.userId },
      };
      // A submitter cannot approve their own item, so it does not belong in
      // their inbox even if their role would otherwise qualify.
      filter.requestedByUserId = { $ne: principal.userId };
    } else if (!principal.permissions.includes('approval:read_all')) {
      throw ApiError.forbidden('Viewing all approvals requires approval:read_all');
    }

    const page = await paginate(
      ApprovalRequest,
      filter,
      {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
        order: q.order,
        defaultSort: { requestedAt: -1 },
      },
      decorate,
    );

    res.json(page);
  }),
);

/**
 * Adds the derived fields the inbox needs: how long this has been waiting,
 * and whether the active step has passed the SLA its rule set.
 */
function decorate(doc: unknown): Record<string, unknown> | null {
  const api = toApi(doc);
  if (!api) return null;

  const request = doc as ApprovalRequestDoc;
  const step = request.steps?.find((entry) => entry.order === request.currentStepOrder);
  const dueAt = step?.dueAt ? new Date(step.dueAt) : null;

  return {
    ...api,
    waitingDays: Math.floor((Date.now() - new Date(request.requestedAt).getTime()) / 86_400_000),
    dueAt: dueAt?.toISOString() ?? null,
    overdue: !!dueAt && dueAt.getTime() < Date.now(),
  };
}

approvalRouter.get(
  '/:id',
  requireAnyPermission('approval:read', 'approval:read_all'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const request = await ApprovalRequest.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    }).lean();
    if (!request) throw ApiError.notFound('Approval request');

    const activeStep = request.steps.find((step) => step.order === request.currentStepOrder);
    res.json({
      ...toApi(request),
      // Lets the client render approve/reject buttons only when they will work.
      canAct:
        request.status === ApprovalStatus.IN_PROGRESS &&
        !!activeStep &&
        activeStep.candidateUserIds.some((id) => id.equals(principal.userId)) &&
        !request.requestedByUserId.equals(principal.userId),
    });
  }),
);

/** Approve or reject the current step — PRD §15. */
approvalRouter.post(
  '/:id/act',
  requireAnyPermission('invoice:approve', 'payroll:approve'),
  validateBody(schemas.approvalActionRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const { action, comment } = req.body as schemas.ApprovalActionRequest;

    const request = await ApprovalRequest.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    }).lean();
    if (!request) throw ApiError.notFound('Approval request');

    // Invoice and payroll approval rights are separate permissions, because
    // payroll must not be approvable by ordinary AP approvers (PRD §18).
    const needed = request.subjectType === 'PAYROLL_BATCH' ? 'payroll:approve' : 'invoice:approve';
    if (!principal.permissions.includes(needed)) {
      throw ApiError.forbidden(`Missing permission: ${needed}`);
    }

    const decision = await approvalService.act(
      {
        requestId: request._id,
        actorUserId: principal.userId,
        actorName: principal.name,
        action,
        comment,
      },
      auditContext(req),
    );

    // Push the outcome back onto the invoice or payroll batch.
    await onApprovalDecided(decision, auditContext(req));

    res.json(toApi(decision.request));
  }),
);

/** Approval rules administration — PRD §36 `/settings/approvals`. */
export const approvalRuleRouter: Router = crudRouter({
  model: ApprovalRule,
  entityType: 'APPROVAL_RULE',
  name: 'approval_rule',
  permissions: {
    read: 'approval_rule:read',
    create: 'approval_rule:create',
    update: 'approval_rule:update',
    delete: 'approval_rule:delete',
  },
  createSchema: schemas.createApprovalRuleRequest,
  updateSchema: schemas.updateApprovalRuleRequest,
  defaultSort: { priority: -1 },
  buildFilter: (q) => (q.appliesTo ? { appliesTo: q.appliesTo } : {}),
});

/**
 * Dry-runs the rule set against a hypothetical amount, so an administrator
 * can see which chain a given invoice would take before saving a rule.
 */
approvalRuleRouter.post(
  '/simulate',
  requirePermission('approval_rule:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const body = req.body as {
      companyId?: string;
      appliesTo?: 'VENDOR_INVOICE' | 'PAYROLL_BATCH';
      amount?: number;
      vendorId?: string;
      departmentId?: string;
      locationId?: string;
    };
    if (typeof body.amount !== 'number') throw ApiError.badRequest('amount (in paise) is required');

    const rules = await ApprovalRule.find({
      ...scopeFilter(principal, body.companyId),
      appliesTo: body.appliesTo ?? 'VENDOR_INVOICE',
      active: true,
    }).lean();

    const { evaluate } = await import('./rule.engine.js');
    const matched = evaluate(
      {
        appliesTo: body.appliesTo ?? 'VENDOR_INVOICE',
        amount: body.amount,
        currency: 'INR',
        vendorId: body.vendorId,
        departmentId: body.departmentId,
        locationId: body.locationId,
      },
      rules.map((rule) => ({ ...rule, id: String(rule._id) })),
    );

    res.json({
      matched: matched ? { id: matched.id, name: matched.name, steps: matched.steps } : null,
      note: matched ? undefined : 'No rule matches; this item would be auto-approved.',
    });
  }),
);

function objectId(value: string | undefined): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid approval id');
  return new Types.ObjectId(value);
}
