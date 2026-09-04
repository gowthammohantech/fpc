import { Types } from 'mongoose';
import {
  ApprovalStatus,
  NotificationType,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  type RoleKey,
} from '@fpc/shared';
import { eventBus } from '../core/eventBus.js';
import { ApprovalRequest } from '../models/approvalRequest.model.js';
import { AuditEvent } from '../models/auditEvent.model.js';
import { Invoice } from '../models/invoice.model.js';
import { Notification } from '../models/notification.model.js';
import { BANK_ACCOUNTS, ROLES, USERS, VENDORS } from './data.org.js';
import { APPROVAL_RULES } from './data.approvals.js';
import { daysFromNow, keyOf, user, type SeedContext } from './context.js';

/** Roles that review invoices, so they hear about a suspected duplicate. */
const DUPLICATE_ALERT_ROLES = ROLE_KEYS.filter((role) =>
  ROLE_PERMISSIONS[role as RoleKey].includes('invoice:resolve_duplicate'),
) as RoleKey[];

const HISTORY_REQUEST_ID = 'seed-history';

/**
 * Publishes the one domain event the seed cannot reach by driving a service.
 *
 * Duplicate detection only fires from `runExtraction`, which the seed does not
 * run, but the register does contain a real duplicate — so the notification is
 * a true statement about the data, not a decoration.
 */
export async function publishSeededEvents(context: SeedContext): Promise<void> {
  const duplicate = await Invoice.findOne({
    tenantId: context.tenantId,
    companyId: context.companyIds.engineering,
    invoiceNumber: 'INV/2210',
  })
    .select('_id vendorName invoiceNumber companyId findings')
    .lean();
  if (!duplicate) return;

  const alreadyNotified = await Notification.exists({
    tenantId: context.tenantId,
    type: NotificationType.INVOICE_DUPLICATE_DETECTED,
    entityId: duplicate._id,
  });
  if (alreadyNotified) return;

  eventBus.publish({
    type: NotificationType.INVOICE_DUPLICATE_DETECTED,
    tenantId: String(context.tenantId),
    companyId: String(duplicate.companyId),
    entityType: 'INVOICE',
    entityId: String(duplicate._id),
    recipientUserIds: [],
    recipientRoleKeys: DUPLICATE_ALERT_ROLES,
    title:
      `Possible duplicate: ${duplicate.vendorName ?? 'invoice'} ${duplicate.invoiceNumber ?? ''}`.trim(),
    body: duplicate.findings[0]?.message ?? 'This invoice may already have been received.',
    link: `/invoices/${String(duplicate._id)}`,
  });
}

/**
 * Drains the notification queue the seed just filled.
 *
 * Two reasons this is not optional. First, `dispatchPendingEmails` takes the
 * oldest 50 pending rows, so leaving dozens of seeded approval emails queued
 * would starve the mail the demo actually sends. Second, a demo that opens on
 * forty unread notifications reads as noise: everything historical is marked
 * read, and only the items genuinely awaiting a decision are left unread.
 */
export async function settleNotifications(context: SeedContext): Promise<void> {
  await eventBus.flush();

  const now = new Date();
  await Notification.updateMany(
    { tenantId: context.tenantId, channel: 'EMAIL', status: 'PENDING' },
    { status: 'SENT', sentAt: now, attempts: 1 },
  );

  const liveRequests = await ApprovalRequest.find({
    tenantId: context.tenantId,
    status: { $in: [ApprovalStatus.PENDING, ApprovalStatus.IN_PROGRESS] },
  })
    .select('_id')
    .lean();

  await Notification.updateMany(
    {
      tenantId: context.tenantId,
      channel: 'IN_APP',
      status: 'PENDING',
      entityId: { $nin: liveRequests.map((entry) => entry._id) },
    },
    { status: 'READ', readAt: now },
  );
}

/**
 * Audit events for actions no seeded service call produces.
 *
 * Master data is created by route handlers with no reusable service behind
 * them, and `audit.record` stamps `new Date()`, so backdated history has to be
 * inserted directly. The append-only guards block updates and deletes but not
 * inserts, and `clear()` drops the collection, so this stays re-runnable.
 */
export async function seedAuditHistory(context: SeedContext): Promise<number> {
  if (await AuditEvent.exists({ tenantId: context.tenantId, requestId: HISTORY_REQUEST_ID })) {
    return 0;
  }

  const admin = user(context, 'admin@nova.example.com');
  const companyAdmin = user(context, 'companyadmin@nova.example.com');
  const rows: Array<Record<string, unknown>> = [];

  const push = (
    daysAgo: number,
    actor: { id: Types.ObjectId; name: string },
    input: {
      event: string;
      entityType: string;
      entityId: Types.ObjectId;
      entityLabel?: string;
      companyId?: Types.ObjectId;
      metadata?: Record<string, unknown>;
    },
  ) => {
    rows.push({
      tenantId: context.tenantId,
      companyId: input.companyId,
      event: input.event,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      userId: actor.id,
      userName: actor.name,
      timestamp: daysFromNow(-daysAgo),
      metadata: input.metadata,
      ip: '203.0.113.10',
      requestId: HISTORY_REQUEST_ID,
    });
  };

  // Master data, set up before anyone started raising invoices.
  let day = 60;
  for (const definition of ROLES) {
    push(day, admin, {
      event: 'role.created',
      entityType: 'ROLE',
      entityId: context.tenantId,
      entityLabel: definition.label,
      metadata: { key: definition.key, permissions: definition.permissions.length },
    });
    day -= 1;
  }

  for (const definition of USERS) {
    const seeded = context.users[definition.email];
    if (!seeded) continue;
    push(day, admin, {
      event: 'user.created',
      entityType: 'USER',
      entityId: seeded.id,
      entityLabel: definition.name,
      metadata: { email: definition.email, roleKeys: definition.roles },
    });
    day = Math.max(day - 1, 40);
  }

  day = 55;
  for (const definition of VENDORS) {
    const vendorId = context.vendorIds[keyOf(definition.company, definition.code)];
    if (!vendorId) continue;
    push(day, companyAdmin, {
      event: 'vendor.created',
      entityType: 'VENDOR',
      entityId: vendorId,
      entityLabel: definition.name,
      companyId: context.companyIds[definition.company],
      metadata: { code: definition.code, paymentTermsDays: definition.paymentTermsDays },
    });
    day = Math.max(day - 1, 45);
  }

  day = 58;
  for (const definition of BANK_ACCOUNTS) {
    const accountId = context.bankAccountIds[definition.key];
    if (!accountId) continue;
    push(day, companyAdmin, {
      event: 'bank_account.created',
      entityType: 'BANK_ACCOUNT',
      entityId: accountId,
      entityLabel: definition.label,
      companyId: context.companyIds[definition.company],
      metadata: { bankFileFormat: definition.bankFileFormat },
    });
    day -= 1;
  }

  day = 50;
  for (const definition of APPROVAL_RULES) {
    push(day, admin, {
      event: 'approval_rule.created',
      entityType: 'APPROVAL_RULE',
      entityId: context.tenantId,
      entityLabel: definition.name,
      companyId: context.companyIds[definition.company],
      metadata: { priority: definition.priority, steps: definition.steps.length },
    });
    day = Math.max(day - 1, 42);
  }

  // Sign-ins, so the audit report has the security events an auditor looks for.
  const signIns = [
    'ravi@nova.example.com',
    'financemanager@nova.example.com',
    'cfo@nova.example.com',
    'payroll@nova.example.com',
    'auditor@nova.example.com',
    'apclerk@nova.example.com',
  ];
  for (const [index, email] of signIns.entries()) {
    const seeded = context.users[email];
    if (!seeded) continue;
    push(
      index + 1,
      { id: seeded.id, name: seeded.name },
      {
        event: 'auth.login',
        entityType: 'AUTH',
        entityId: seeded.id,
        entityLabel: email,
      },
    );
  }

  await AuditEvent.insertMany(rows);
  return rows.length;
}
