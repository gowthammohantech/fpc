import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Tenant } from '../models/tenant.model.js';
import { registerNotificationHandlers } from '../modules/notifications/notification.service.js';
import { writeFixtures } from './fixtures.js';
import { seed } from './seed.js';

/**
 * Seeds the demo dataset at boot when `SEED_ON_STARTUP=true`.
 *
 * Meant for deployments with no shell to run `node dist/seed/run.js` from —
 * a Railway demo, a fresh container — which is also why this is not gated on
 * NODE_ENV: those deployments run as production.
 *
 * What keeps it safe instead is that it only ever runs against an empty
 * database. It never resets: the seed is not idempotent end to end (invoices,
 * payment batches and audit rows are appended, not upserted), so running it
 * over existing data would duplicate the demo, and running it with `--reset`
 * on someone's real data would destroy it. A restart of an already-seeded
 * deployment therefore does nothing.
 */
export async function seedOnStartup(): Promise<void> {
  if (!env.SEED_ON_STARTUP) return;

  // `exists` rather than a count: it stops at the first row, and estimated
  // counts read collection metadata that lags behind a delete.
  const existing = await Tenant.exists({});
  if (existing) {
    logger.info('SEED_ON_STARTUP set but the database already has data; skipping seed');
    return;
  }

  // Without this the seed publishes domain events that nothing is listening
  // for, and the demo opens with an empty notification list.
  registerNotificationHandlers();

  logger.info('SEED_ON_STARTUP set and the database is empty; seeding demo data');
  const result = await seed();
  await writeFixtures();
  logger.info(result.summary, 'startup seed complete');
}
