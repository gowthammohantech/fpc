import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Tenant } from '../models/tenant.model.js';
import { databaseSkipReason, startTestDatabase, stopTestDatabase } from '../test/db.js';
import { TENANT } from './data.org.js';
import { seed } from './seed.js';
import { seedOnStartup } from './startup.js';

/**
 * The startup seed's only safeguard is that it refuses to run over a database
 * that already has rows — the seed appends invoices, payments and audit
 * events, so a second run against a live deployment would duplicate the demo.
 *
 * The seed itself is stubbed: what needs proving here is the guard, and the
 * dataset it builds is already covered by `coverage.integration.test.ts`.
 */
let flag = false;

// `env` is parsed once at import, and re-importing it would re-register every
// Mongoose model, so the flag is read through a getter instead.
vi.mock('../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get SEED_ON_STARTUP() {
        return flag;
      },
    },
  };
});

vi.mock('./seed.js', () => ({
  seed: vi.fn(async () => ({
    tenantId: undefined,
    companyIds: {},
    userIds: {},
    summary: { invoices: 1 },
  })),
}));
vi.mock('./fixtures.js', () => ({ writeFixtures: vi.fn(async () => undefined) }));

const seedMock = vi.mocked(seed);

beforeAll(async () => {
  await startTestDatabase('seed-startup');
});

afterAll(async () => {
  await stopTestDatabase();
});

afterEach(async () => {
  flag = false;
  seedMock.mockClear();
  await Tenant.deleteMany({});
});

describe.skipIf(databaseSkipReason())('seedOnStartup', () => {
  it('seeds when the flag is on and the database is empty', async () => {
    flag = true;
    await seedOnStartup();
    expect(seedMock).toHaveBeenCalledOnce();
  });

  it('does nothing when the database already has data', async () => {
    flag = true;
    await Tenant.create({ ...TENANT, active: true });
    await seedOnStartup();
    expect(seedMock).not.toHaveBeenCalled();
  });

  it('does nothing when the flag is off', async () => {
    await seedOnStartup();
    expect(seedMock).not.toHaveBeenCalled();
  });
});
