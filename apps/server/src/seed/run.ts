import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { registerNotificationHandlers } from '../modules/notifications/notification.service.js';
import { DEMO_PASSWORD, USERS } from './data.js';
import { writeFixtures } from './fixtures.js';
import { seed } from './seed.js';

/**
 * `pnpm seed` — builds the demo dataset and the fixture files the two
 * flagship journeys need.
 *
 * Pass `--reset` to wipe existing data first, or `--skip-payroll-history` to
 * leave out last month's settled payroll run, which is most of the runtime.
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const payrollHistory = !process.argv.includes('--skip-payroll-history');

  // Without this the seed publishes domain events that nothing is listening
  // for, and the demo opens with an empty notification list.
  registerNotificationHandlers();

  await connectDatabase();
  const result = await seed({ reset, payrollHistory });
  await writeFixtures();
  await disconnectDatabase();

  const rows = Object.entries(result.summary)
    .map(([key, value]) => `  ${key.padEnd(20)} ${value}`)
    .join('\n');

  const signIn = USERS.filter((entry) => (entry.status ?? 'ACTIVE') === 'ACTIVE');
  const cannotSignIn = USERS.filter((entry) => (entry.status ?? 'ACTIVE') !== 'ACTIVE');

  process.stdout.write(
    [
      '',
      'Demo data ready.',
      '',
      rows,
      '',
      `These accounts use the password: ${DEMO_PASSWORD}`,
      '',
      ...signIn.map((user) => `  ${user.email.padEnd(36)} ${user.note}`),
      '',
      'These accounts exist but cannot sign in:',
      '',
      ...cannotSignIn.map((user) => `  ${user.email.padEnd(36)} ${user.status} — ${user.note}`),
      '',
      'Fixtures written:',
      `  ${env.MAIL_FIXTURE_DIR}/INV-9930.pdf         drop-in invoice for the email intake demo`,
      '  fixtures/payroll/September-Payroll.xlsx   payroll import demo',
      '  fixtures/statements/HDFC-Statement.xlsx   statement import demo',
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  logger.fatal({ err: error }, 'seed failed');
  process.exit(1);
});
