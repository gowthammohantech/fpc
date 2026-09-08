import { Types } from 'mongoose';
import {
  FinanceRequestStatus,
  InvoiceStatus,
  NotificationType,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  financeRequestMachine,
  formatINR,
  type FinanceRequestAction,
  type FinanceRequestPriority,
  type RoleKey,
} from '@fpc/shared';
import { ApiError } from '../../core/errors.js';
import { eventBus } from '../../core/eventBus.js';
import { REFERENCE_PREFIX, nextReference } from '../../core/sequence.js';
import { FinanceRequest, type FinanceRequestDoc } from '../../models/financeRequest.model.js';
import type { InvoiceDoc } from '../../models/invoice.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import * as invoiceService from '../invoices/invoice.service.js';

/** Roles that decide escalations, so the Treasury inbox lights up for them. */
const TREASURY_ROLES: RoleKey[] = ROLE_KEYS.filter((role) =>
  ROLE_PERMISSIONS[role as RoleKey].includes('finance_request:act'),
) as RoleKey[];

type LiveInvoice = InvoiceDoc & { _id: Types.ObjectId; save(): Promise<unknown> };
type LiveRequest = FinanceRequestDoc & { _id: Types.ObjectId; save(): Promise<unknown> };

export interface OpenFinanceRequestInput {
  invoice: LiveInvoice;
  priority: FinanceRequestPriority;
  remarks: string;
  requestedByUserId: Types.ObjectId;
  requestedByName: string;
}

/**
 * Raises a Treasury escalation for one invoice and parks the invoice on it.
 *
 * The amounts are snapshotted rather than read back through the invoice, so
 * Treasury decides on the figures that were put in front of them even if
 * accounting later re-verifies a returned invoice.
 */
export async function open(
  input: OpenFinanceRequestInput,
  context: AuditContext,
): Promise<LiveRequest> {
  const { invoice } = input;

  const existing = await FinanceRequest.findOne({
    tenantId: invoice.tenantId,
    invoiceId: invoice._id,
    status: FinanceRequestStatus.PENDING,
  }).lean();
  if (existing) {
    throw ApiError.conflict(`${invoice.trackingId} already has an open Treasury request`);
  }

  const request = await FinanceRequest.create({
    tenantId: invoice.tenantId,
    companyId: invoice.companyId,
    groupId: invoice.groupId,
    regionId: invoice.regionId,
    verticalId: invoice.verticalId,
    businessUnitId: invoice.businessUnitId,
    locationId: invoice.locationId,
    departmentId: invoice.departmentId,
    reference: await nextReference(invoice.tenantId, REFERENCE_PREFIX.FINANCE_REQUEST),
    invoiceId: invoice._id,
    invoiceTrackingId: invoice.trackingId,
    subjectLabel: `${invoice.vendorName ?? 'Invoice'} ${invoice.invoiceNumber ?? ''}`.trim(),
    vendorId: invoice.vendorId,
    vendorName: invoice.vendorName,
    grossAmount: invoice.totalAmount ?? 0,
    tdsAmount: invoice.tdsAmount,
    netPayable: invoice.netPayable,
    currency: 'INR',
    priority: input.priority,
    status: FinanceRequestStatus.PENDING,
    requestedByUserId: input.requestedByUserId,
    requestedByName: input.requestedByName,
    requestedAt: new Date(),
    remarks: [
      {
        userId: input.requestedByUserId,
        userName: input.requestedByName,
        at: new Date(),
        action: 'RAISED',
        text: input.remarks,
      },
    ],
  });

  const from = invoice.status;
  await invoiceService.transition(invoice, InvoiceStatus.TREASURY_APPROVAL);
  invoice.financeRequestId = request._id;
  await invoice.save();

  await audit.recordStatusChange(
    {
      event: 'finance_request.raised',
      entityType: 'FINANCE_REQUEST',
      entityId: request._id,
      entityLabel: request.reference,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: InvoiceStatus.TREASURY_APPROVAL,
      metadata: {
        invoiceId: String(invoice._id),
        trackingId: invoice.trackingId,
        priority: input.priority,
        netPayable: invoice.netPayable,
      },
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.FINANCE_REQUEST_RAISED,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'FINANCE_REQUEST',
    entityId: String(request._id),
    recipientUserIds: [],
    recipientRoleKeys: TREASURY_ROLES,
    title: `${input.priority}: ${request.reference} needs a Treasury decision`,
    body: `${invoice.vendorName ?? 'An invoice'} for ${formatINR(invoice.netPayable)} net. ${input.remarks}`,
    link: `/finance-requests/${String(request._id)}`,
  });

  return request;
}

export interface DecideInput {
  request: LiveRequest;
  invoice: LiveInvoice;
  action: FinanceRequestAction;
  remarks?: string;
  actedByUserId: Types.ObjectId;
  actedByName: string;
}

const OUTCOME: Record<FinanceRequestAction, FinanceRequestStatus> = {
  APPROVE: FinanceRequestStatus.APPROVED,
  REJECT: FinanceRequestStatus.REJECTED,
  RETURN: FinanceRequestStatus.RETURNED,
};

/**
 * Applies Treasury's decision to both the request and the invoice.
 *
 * The only place a finance request closes, mirroring how the approval
 * dispatcher is the only place an approval chain becomes a lifecycle change.
 */
export async function decide(input: DecideInput, context: AuditContext): Promise<void> {
  const { request, invoice } = input;

  if (request.status !== FinanceRequestStatus.PENDING) {
    throw ApiError.conflict(`${request.reference} has already been decided`);
  }
  assertNotOwnRequest(request, input.actedByUserId);

  const outcome = OUTCOME[input.action];
  financeRequestMachine.assertTransition(request.status, outcome);

  request.status = outcome;
  request.decision = input.action;
  request.decidedByUserId = input.actedByUserId;
  request.decidedByName = input.actedByName;
  request.decidedAt = new Date();
  if (input.remarks) {
    request.remarks.push({
      userId: input.actedByUserId,
      userName: input.actedByName,
      at: new Date(),
      action: input.action,
      text: input.remarks,
    });
  }
  await request.save();

  invoice.financeRequestId = undefined;
  const from = invoice.status;

  if (input.action === 'APPROVE') {
    await invoiceService.releaseToAccountsPayable(invoice, context);
  } else if (input.action === 'RETURN') {
    // Back to accounting for rework. Re-escalating opens a new request with a
    // new reference, so each round trip is a row rather than a mutation.
    await invoiceService.transition(invoice, InvoiceStatus.ACCOUNTING_VERIFICATION);
    await invoice.save();
  } else {
    await invoiceService.transition(invoice, InvoiceStatus.REJECTED);
    await invoice.save();
  }

  await audit.recordStatusChange(
    {
      event: `finance_request.${outcome.toLowerCase()}`,
      entityType: 'FINANCE_REQUEST',
      entityId: request._id,
      entityLabel: request.reference,
      tenantId: request.tenantId,
      companyId: request.companyId,
      from,
      to: invoice.status,
      metadata: { invoiceId: String(invoice._id), remarks: input.remarks },
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.FINANCE_REQUEST_DECIDED,
    tenantId: String(request.tenantId),
    companyId: String(request.companyId),
    entityType: 'FINANCE_REQUEST',
    entityId: String(request._id),
    recipientUserIds: [String(request.requestedByUserId)],
    title: `${request.reference} was ${outcome.toLowerCase()}`,
    body: input.remarks ?? `Treasury ${outcome.toLowerCase()} ${request.subjectLabel}.`,
    link: `/finance-requests/${String(request._id)}`,
  });
}

/**
 * The person who raised an escalation cannot decide it.
 *
 * The same segregation the approval chain enforces with
 * `assertNotSelfApproval`: a user holding both roles must still hand the
 * decision to someone else.
 */
export function assertNotOwnRequest(
  request: Pick<FinanceRequestDoc, 'requestedByUserId'>,
  actorUserId: Types.ObjectId,
): void {
  if (request.requestedByUserId.equals(actorUserId)) {
    throw ApiError.forbidden(
      'You raised this request, so you cannot decide it. Another member of Treasury must act.',
    );
  }
}

/** Closes any open escalation when its invoice is cancelled. */
export async function cancelForInvoice(
  invoiceId: Types.ObjectId,
  reason: string,
  context: AuditContext,
): Promise<void> {
  const request = await FinanceRequest.findOne({
    invoiceId,
    status: FinanceRequestStatus.PENDING,
  });
  if (!request) return;

  financeRequestMachine.assertTransition(request.status, FinanceRequestStatus.CANCELLED);
  request.status = FinanceRequestStatus.CANCELLED;
  request.decidedAt = new Date();
  await request.save();

  await audit.record(
    {
      event: 'finance_request.cancelled',
      entityType: 'FINANCE_REQUEST',
      entityId: request._id,
      entityLabel: request.reference,
      tenantId: request.tenantId,
      companyId: request.companyId,
      metadata: { reason },
    },
    context,
  );
}
