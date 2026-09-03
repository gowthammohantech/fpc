import { Types } from 'mongoose';
import {
  ApprovalStatus,
  ApprovalSubjectType,
  NotificationType,
  formatINR,
  type ApprovalSubjectType as SubjectType,
  type RoleKey,
} from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../core/errors.js';
import { eventBus } from '../../core/eventBus.js';
import {
  ApprovalRequest,
  type ApprovalRequestDoc,
  type ApprovalStepDoc,
} from '../../models/approvalRequest.model.js';
import { ApprovalRule } from '../../models/approvalRule.model.js';
import { Department } from '../../models/department.model.js';
import { User } from '../../models/user.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { evaluate, type RuleContext } from './rule.engine.js';

export interface StartApprovalInput {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  subjectType: SubjectType;
  subjectId: Types.ObjectId;
  subjectLabel: string;
  /** Minor units. */
  amount: number;
  requestedByUserId: Types.ObjectId;
  departmentId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  employeeCount?: number;
  link?: string;
}

export interface StartApprovalResult {
  status: ApprovalStatus;
  request: (ApprovalRequestDoc & { _id: Types.ObjectId }) | null;
  /** Set when no rule matched and the subject was auto-approved. */
  autoApprovedReason?: string;
}

/**
 * Builds the approval chain for a subject and activates its first step.
 *
 * When no rule matches, the subject is auto-approved with a recorded reason
 * rather than being stranded in limbo — a missing rule is an administrative
 * gap, and the audit trail says so explicitly.
 */
export async function startApproval(
  input: StartApprovalInput,
  context: AuditContext,
): Promise<StartApprovalResult> {
  const rules = await ApprovalRule.find({
    tenantId: input.tenantId,
    companyId: input.companyId,
    appliesTo: input.subjectType,
    active: true,
  }).lean();

  const ruleContext: RuleContext = {
    appliesTo: input.subjectType,
    amount: input.amount,
    currency: 'INR',
    vendorId: input.vendorId ? String(input.vendorId) : undefined,
    departmentId: input.departmentId ? String(input.departmentId) : undefined,
    locationId: input.locationId ? String(input.locationId) : undefined,
    employeeCount: input.employeeCount,
  };

  const matched = evaluate(
    ruleContext,
    rules.map((rule) => ({ ...rule, id: String(rule._id) })),
  );

  if (!matched) {
    const reason = `No approval rule matched ${input.subjectType} for ${formatINR(input.amount)}`;
    logger.warn({ subjectId: String(input.subjectId) }, reason);
    await audit.record(
      {
        event: 'approval.auto_approved',
        entityType: 'APPROVAL_REQUEST',
        entityId: input.subjectId,
        entityLabel: input.subjectLabel,
        tenantId: input.tenantId,
        companyId: input.companyId,
        metadata: { reason },
      },
      context,
    );
    return { status: ApprovalStatus.APPROVED, request: null, autoApprovedReason: reason };
  }

  const steps = await materializeSteps(matched.steps, input);

  const request = await ApprovalRequest.create({
    tenantId: input.tenantId,
    companyId: input.companyId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectLabel: input.subjectLabel,
    amount: input.amount,
    currency: 'INR',
    ruleId: new Types.ObjectId(matched.id),
    ruleName: matched.name,
    status: ApprovalStatus.IN_PROGRESS,
    currentStepOrder: steps[0]!.order,
    steps,
    requestedByUserId: input.requestedByUserId,
    requestedAt: new Date(),
  });

  await audit.record(
    {
      event: 'approval.requested',
      entityType: 'APPROVAL_REQUEST',
      entityId: request._id,
      entityLabel: input.subjectLabel,
      tenantId: input.tenantId,
      companyId: input.companyId,
      metadata: {
        rule: matched.name,
        amount: input.amount,
        chain: steps.map((step) => step.label),
      },
    },
    context,
  );

  notifyActiveStep(request, input.link);
  return { status: ApprovalStatus.IN_PROGRESS, request };
}

/**
 * Resolves each rule step into concrete candidate approvers.
 *
 * A step with no eligible approver is a configuration error that would strand
 * the invoice, so it fails loudly here rather than silently skipping a level
 * of oversight.
 */
async function materializeSteps(
  definitions: Array<{
    order: number;
    approverType: string;
    roleKey?: string;
    userId?: unknown;
    label?: string;
    slaHours?: number;
  }>,
  input: StartApprovalInput,
): Promise<ApprovalStepDoc[]> {
  const ordered = [...definitions].sort((a, b) => a.order - b.order);
  const steps: ApprovalStepDoc[] = [];

  for (const [index, definition] of ordered.entries()) {
    let candidateUserIds: Types.ObjectId[] = [];
    let label = definition.label ?? '';

    if (definition.approverType === 'USER' && definition.userId) {
      const user = await User.findOne({
        _id: new Types.ObjectId(String(definition.userId)),
        tenantId: input.tenantId,
        status: 'ACTIVE',
      })
        .select('name')
        .lean();
      if (user) {
        candidateUserIds = [user._id];
        label ||= user.name;
      }
    } else if (definition.approverType === 'DEPARTMENT_HEAD') {
      const department = input.departmentId
        ? await Department.findById(input.departmentId).lean()
        : null;
      if (department?.headUserId) {
        candidateUserIds = [department.headUserId];
        label ||= `${department.name} Head`;
      } else {
        // Without a department, fall back to anyone holding the generic
        // approver role rather than blocking the invoice entirely.
        candidateUserIds = await usersWithRole(input, 'APPROVER');
        label ||= 'Department Head';
      }
    } else if (definition.approverType === 'ROLE' && definition.roleKey) {
      candidateUserIds = await usersWithRole(input, definition.roleKey as RoleKey);
      label ||= humanizeRole(definition.roleKey);
    }

    if (!candidateUserIds.length) {
      throw ApiError.unprocessable(
        `Approval rule step ${definition.order} (${label || definition.approverType}) has no eligible approver in this company. ` +
          'Assign the role to a user, or amend the rule, before submitting.',
      );
    }

    steps.push({
      order: definition.order,
      label,
      approverType: definition.approverType as ApprovalStepDoc['approverType'],
      roleKey: definition.roleKey as RoleKey | undefined,
      candidateUserIds,
      status: index === 0 ? 'ACTIVE' : 'PENDING',
      slaHours: definition.slaHours,
      dueAt: definition.slaHours
        ? new Date(Date.now() + definition.slaHours * 3_600_000)
        : undefined,
    });
  }

  return steps;
}

async function usersWithRole(
  input: StartApprovalInput,
  roleKey: RoleKey,
): Promise<Types.ObjectId[]> {
  const users = await User.find({
    tenantId: input.tenantId,
    roleKeys: roleKey,
    status: 'ACTIVE',
    // A user scoped to no company is tenant-wide and eligible everywhere.
    $or: [{ companyIds: input.companyId }, { companyIds: { $size: 0 } }],
  })
    .select('_id')
    .lean();
  return users.map((user) => user._id);
}

export interface ActOnApprovalInput {
  requestId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  actorName: string;
  action: 'APPROVE' | 'REJECT';
  comment?: string;
}

export interface ApprovalDecision {
  request: ApprovalRequestDoc & { _id: Types.ObjectId };
  /** True when this action completed the whole chain. */
  completed: boolean;
  finalStatus: ApprovalStatus;
}

/**
 * Records one approver's decision and advances the chain.
 *
 * Enforces two rules the PRD calls out: steps are strictly sequential, and a
 * user may not approve their own submission (PRD §7 — "cannot approve own
 * payment").
 */
export async function act(
  input: ActOnApprovalInput,
  context: AuditContext,
): Promise<ApprovalDecision> {
  const request = await ApprovalRequest.findById(input.requestId);
  if (!request) throw ApiError.notFound('Approval request');

  if (request.status !== ApprovalStatus.IN_PROGRESS && request.status !== ApprovalStatus.PENDING) {
    throw ApiError.conflict(`This approval is already ${request.status.toLowerCase()}`);
  }

  const step = request.steps.find((entry) => entry.order === request.currentStepOrder);
  if (!step || step.status !== 'ACTIVE') {
    throw ApiError.conflict('There is no step awaiting a decision on this request');
  }

  if (!step.candidateUserIds.some((candidate) => candidate.equals(input.actorUserId))) {
    throw ApiError.forbidden('You are not an approver for the current step');
  }

  assertNotSelfApproval(request, input.actorUserId);

  step.status = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  step.actedByUserId = input.actorUserId;
  step.actedByName = input.actorName;
  step.actedAt = new Date();
  step.comment = input.comment;

  let completed = false;
  if (input.action === 'REJECT') {
    request.status = ApprovalStatus.REJECTED;
    request.completedAt = new Date();
    // Later steps never got a say; mark them so the timeline reads correctly.
    for (const later of request.steps.filter((entry) => entry.order > step.order)) {
      later.status = 'SKIPPED';
    }
    completed = true;
  } else {
    const next = request.steps
      .filter((entry) => entry.order > step.order)
      .sort((a, b) => a.order - b.order)[0];

    if (next) {
      next.status = 'ACTIVE';
      if (next.slaHours) next.dueAt = new Date(Date.now() + next.slaHours * 3_600_000);
      request.currentStepOrder = next.order;
    } else {
      request.status = ApprovalStatus.APPROVED;
      request.completedAt = new Date();
      completed = true;
    }
  }

  request.markModified('steps');
  await request.save();

  await audit.record(
    {
      event: input.action === 'APPROVE' ? 'approval.step_approved' : 'approval.step_rejected',
      entityType: 'APPROVAL_REQUEST',
      entityId: request._id,
      entityLabel: request.subjectLabel,
      tenantId: request.tenantId,
      companyId: request.companyId,
      oldValue: { step: step.order, status: 'ACTIVE' },
      newValue: { step: step.order, status: step.status },
      metadata: { approver: input.actorName, comment: input.comment, level: step.label },
    },
    context,
  );

  if (!completed) notifyActiveStep(request);

  return {
    request: request.toObject() as ApprovalRequestDoc & { _id: Types.ObjectId },
    completed,
    finalStatus: request.status,
  };
}

/**
 * Segregation of duties: the person who submitted an item cannot approve it,
 * at any level of the chain (PRD §7).
 */
export function assertNotSelfApproval(
  request: Pick<ApprovalRequestDoc, 'requestedByUserId'>,
  actorUserId: Types.ObjectId,
): void {
  if (request.requestedByUserId.equals(actorUserId)) {
    throw ApiError.forbidden(
      'You submitted this item, so you cannot approve it. Another approver must act.',
    );
  }
}

/** Cancels an in-flight chain, e.g. when the underlying invoice is cancelled. */
export async function cancel(
  subjectId: Types.ObjectId,
  reason: string,
  context: AuditContext,
): Promise<void> {
  const request = await ApprovalRequest.findOne({
    subjectId,
    status: { $in: [ApprovalStatus.PENDING, ApprovalStatus.IN_PROGRESS] },
  });
  if (!request) return;

  request.status = ApprovalStatus.CANCELLED;
  request.completedAt = new Date();
  for (const step of request.steps) {
    if (step.status === 'PENDING' || step.status === 'ACTIVE') step.status = 'SKIPPED';
  }
  request.markModified('steps');
  await request.save();

  await audit.record(
    {
      event: 'approval.cancelled',
      entityType: 'APPROVAL_REQUEST',
      entityId: request._id,
      entityLabel: request.subjectLabel,
      tenantId: request.tenantId,
      companyId: request.companyId,
      metadata: { reason },
    },
    context,
  );
}

function notifyActiveStep(
  request: ApprovalRequestDoc & { _id: Types.ObjectId },
  link?: string,
): void {
  const step = request.steps.find((entry) => entry.order === request.currentStepOrder);
  if (!step) return;

  eventBus.publish({
    type:
      request.subjectType === ApprovalSubjectType.PAYROLL_BATCH
        ? NotificationType.PAYROLL_AWAITING_APPROVAL
        : NotificationType.INVOICE_AWAITING_APPROVAL,
    tenantId: String(request.tenantId),
    companyId: String(request.companyId),
    entityType: 'APPROVAL_REQUEST',
    entityId: String(request._id),
    recipientUserIds: step.candidateUserIds.map(String),
    title: `Approval needed: ${request.subjectLabel}`,
    body: `${request.subjectLabel} for ${formatINR(request.amount)} is awaiting your approval (${step.label}).`,
    link: link ?? `/approvals/${String(request._id)}`,
    metadata: { amount: request.amount, level: step.label, rule: request.ruleName },
  });
}

function humanizeRole(roleKey: string): string {
  return roleKey
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
