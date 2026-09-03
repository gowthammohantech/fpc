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

  const recipients = [...new Set(event.recipientUserIds ?? [])];
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

function htmlBody(title: string, body: string, link?: string): string {
  const paragraphs = body
    .split('\n')
    .map((line) => (line.trim() ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : '<br/>'))
    .join('');

  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px;color:#1f2937">',
    `<h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h2>`,
    paragraphs,
    link
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="color:#2563eb">Open in Finance Operations</a></p>`
      : '',
    '</div>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
