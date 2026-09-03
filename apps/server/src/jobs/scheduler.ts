import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { processPendingExtractions } from './extractionWorker.js';
import { pollInvoiceMailboxes } from './mailPoller.js';
import { dispatchPendingEmails, registerNotificationHandlers } from '../modules/notifications/notification.service.js';

const tasks: ScheduledTask[] = [];

/**
 * Schedules background work.
 *
 * Jobs run in-process and are guarded so that one slow run cannot overlap the
 * next. A single API instance is assumed for the MVP; scaling out would mean
 * moving these behind a real queue.
 */
export function startScheduler(): void {
  // Handlers are registered even when jobs are disabled, so in-app
  // notifications still appear; only the email sweep needs a schedule.
  registerNotificationHandlers();

  if (!env.JOBS_ENABLED) {
    logger.info('background jobs disabled (JOBS_ENABLED=false)');
    return;
  }

  schedule('invoice-mail-poll', env.MAIL_POLL_CRON, pollInvoiceMailboxes);
  schedule('invoice-extraction', env.EXTRACTION_POLL_CRON, processPendingExtractions);
  schedule('notification-email', env.NOTIFICATION_POLL_CRON, () => dispatchPendingEmails());

  logger.info({ jobs: tasks.length }, 'background jobs scheduled');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}

const running = new Set<string>();

export function schedule(name: string, expression: string, run: () => Promise<unknown>): void {
  if (!cron.validate(expression)) {
    logger.error({ name, expression }, 'invalid cron expression; job not scheduled');
    return;
  }

  tasks.push(
    cron.schedule(expression, () => {
      if (running.has(name)) {
        logger.warn({ job: name }, 'previous run still in progress; skipping this tick');
        return;
      }
      running.add(name);
      const startedAt = Date.now();
      void run()
        .then((result) => {
          logger.debug({ job: name, ms: Date.now() - startedAt, result }, 'job finished');
        })
        .catch((error) => logger.error({ err: error, job: name }, 'job failed'))
        .finally(() => running.delete(name));
    }),
  );
}
