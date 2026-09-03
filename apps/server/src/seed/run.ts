import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { DEMO_PASSWORD, USERS } from './data.js';
import { writeFixtures } from './fixtures.js';
import { seed } from './seed.js';

/**
 * `pnpm seed` — builds the demo dataset and the fixture files the two
 * flagship journeys need.
 *
 * Pass `--reset` to wipe existing data first.
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  await connectDatabase();
  const result = await seed({ reset });
  await writeFixtures();
  await disconnectDatabase();

  const rows = Object.entries(result.summary)
    .map(([key, value]) => `  ${key.padEnd(20)} ${value}`)
    .join('\n');

  process.stdout.write(
    [
      '',
      'Demo data ready.',
      '',
      rows,
      '',
      `All accounts use the password: ${DEMO_PASSWORD}`,
      '',
      ...USERS.map((user) => `  ${user.email.padEnd(36)} ${user.note}`),
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
