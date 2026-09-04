import { Types } from 'mongoose';
import { NotificationType } from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { eventBus, type DomainEvent } from '../../core/eventBus.js';
import { mailer } from '../../integrations/email/index.js';
import { Notification } from '../../models/notification.model.js';
import { User } from '../../models/user.model.js';

/**
 * Notifications — PRD §34.
 *
 * Domain services publish facts on the event bus; this module turns them into
 * in-app rows and queued email. Keeping it on the far side of the bus means an
 * email failure can never roll back an approved invoice or a confirmed
 * reconciliation.
 *
 * Email is written as a PENDING row first and sent by a background sweep, so
 * a send failure is retried rather than lost.
 */

/** Events that also reach the recipient by email, not just in-app. */
const EMAIL_WORTHY = new Set<NotificationType>([
  NotificationType.INVOICE_AWAITING_APPROVAL,
  NotificationType.INVOICE_REJECTED,
  NotificationType.PAYROLL_AWAITING_APPROVAL,
  NotificationType.PAYROLL_REJECTED,
  NotificationType.VENDOR_PAYMENT_COMPLETED,
  NotificationType.PAYMENT_BATCH_EXPORTED,
]);

export function registerNotificationHandlers(): void {
  eventBus.subscribe(handleDomainEvent);
  logger.info('notification handlers registered');
}

export async function handleDomainEvent(event: DomainEvent): Promise<void> {
  const base = {
    tenantId: new Types.ObjectId(event.tenantId),
    companyId: event.companyId ? new Types.ObjectId(event.companyId) : undefined,
    type: event.type,
    title: event.title,
    body: event.body,
    link: event.link,
    entityType: event.entityType,
    entityId: new Types.ObjectId(event.entityId),
  };

  const recipients = [
    ...new Set([...(event.recipientUserIds ?? []), ...(await resolveRoleRecipients(event))]),
  ];

  // A domain event with no destination is a bug — it used to be published and
  // then silently dropped by the guards below.
  if (!recipients.length && !event.recipientEmail) {
    logger.warn(
      { type: event.type, entityId: event.entityId },
      'domain event resolved to no recipients; nothing will be notified',
    );
    return;
  }

  if (recipients.length) {
    await Notification.insertMany(
      recipients.map((userId) => ({
        ...base,
        userId: new Types.ObjectId(userId),
        channel: 'IN_APP',
        status: 'PENDING',
      })),
    );

    if (EMAIL_WORTHY.has(event.type)) {
      const users = await User.find({
        _id: { $in: recipients.map((id) => new Types.ObjectId(id)) },
        status: 'ACTIVE',
      })
        .select('email')
        .lean();

      if (users.length) {
        await Notification.insertMany(
          users.map((user) => ({
            ...base,
            userId: user._id,
            toEmail: user.email,
            channel: 'EMAIL',
            status: 'PENDING',
          })),
        );
      }
    }
  }

  // External recipient — the vendor payment confirmation (PRD §28).
  if (event.recipientEmail) {
    await Notification.create({
      ...base,
      toEmail: event.recipientEmail,
      channel: 'EMAIL',
      status: 'PENDING',
    });
  }
}

/** Expands `recipientRoleKeys` into the active users holding those roles. */
async function resolveRoleRecipients(event: DomainEvent): Promise<string[]> {
  if (!event.recipientRoleKeys?.length || !event.companyId) return [];

  const users = await User.find({
    tenantId: new Types.ObjectId(event.tenantId),
    status: 'ACTIVE',
    roleKeys: { $in: event.recipientRoleKeys },
    // A user scoped to no company is tenant-wide and eligible everywhere.
    $or: [{ companyIds: new Types.ObjectId(event.companyId) }, { companyIds: { $size: 0 } }],
  })
    .select('_id')
    .lean();

  return users.map((user) => String(user._id));
}

const MAX_ATTEMPTS = 3;

/**
 * Sends queued email. Run on a schedule so a transient SMTP failure is
 * retried instead of silently dropping a vendor's payment confirmation.
 */
export async function dispatchPendingEmails(limit = 50): Promise<{ sent: number; failed: number }> {
  const pending = await Notification.find({
    channel: 'EMAIL',
    status: 'PENDING',
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .limit(limit)
    .sort({ createdAt: 1 });

  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    if (!notification.toEmail) {
      notification.status = 'FAILED';
      notification.error = 'No recipient address';
      await notification.save();
      failed += 1;
      continue;
    }

    notification.attempts += 1;
    try {
      await mailer().send({
        to: notification.toEmail,
        subject: notification.title,
        text: notification.body,
        html: htmlBody(notification.title, notification.body, notification.link),
      });
      notification.status = 'SENT';
      notification.sentAt = new Date();
      sent += 1;
    } catch (error) {
      notification.error = (error as Error).message;
      // Only give up once the retry budget is spent.
      if (notification.attempts >= MAX_ATTEMPTS) notification.status = 'FAILED';
      failed += 1;
      logger.warn(
        { err: error, notificationId: String(notification._id), attempts: notification.attempts },
        'notification email failed',
      );
    }
    await notification.save();
  }

  return { sent, failed };
}

/**
 * Renders one notification as an email.
 *
 * Tables and inline styles only, with no web font and no remote image: mail
 * clients strip stylesheets and many block images by default, so the Apex
 * palette has to survive as literal hex on the elements themselves.
 */
function htmlBody(title: string, body: string, link?: string): string {
  const font = "font-family:'Inter Tight',system-ui,-apple-system,Segoe UI,sans-serif";

  const paragraphs = body
    .split('\n')
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(line)}</p>`
        : '<br/>',
    )
    .join('');

  return [
    `<div style="${font};background:#f8fafc;padding:24px 0">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"' +
      ' style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;' +
      'border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">',

    // Header band. White on Sports Teal is 6.29:1, and the peridot mark is the
    // one place the accent is legible against a dark ground.
    '<tr><td style="background:#14697b;padding:20px 28px">' +
      `<span style="${font};color:#ffffff;font-size:15px;font-weight:600">Finance Ops</span>` +
      '<span style="color:#e0ea49;font-size:15px;font-weight:700">.</span>' +
      '</td></tr>',

    `<tr><td style="padding:28px;${font};color:#0f172b">`,
    `<h2 style="font-size:19px;line-height:1.35;margin:0 0 16px;color:#0f172b">${escapeHtml(title)}</h2>`,
    paragraphs,
    link
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#14697b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:999px">Open in Finance Operations</a></p>`
      : '',
    '</td></tr>',

    `<tr><td style="border-top:1px solid #e2e8f0;padding:16px 28px;${font};color:#64748b;font-size:12px">`,
    'You are receiving this because of your role in Finance Operations.',
    '</td></tr>',

    '</table></div>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
