import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@fpc/shared';
import { createApp } from './app.js';
import { DEMO_PASSWORD } from './seed/data.js';
import { seed } from './seed/seed.js';
import { databaseSkipReason, startTestDatabase, stopTestDatabase } from './test/db.js';

/**
 * RBAC and tenant-isolation coverage against a real database.
 *
 * Needs a MongoDB. `mongodb-memory-server` provides one automatically where it
 * can download a binary; otherwise set MONGO_TEST_URI. When neither is
 * available the suite skips with a clear reason rather than failing for an
 * environmental cause.
 */
let app: Express;

// Vitest decides which suites to collect before any `beforeAll` runs, so the
// database has to be reachable at module scope. Connecting inside `beforeAll`
// would leave `available` false at collection time and skip the whole suite
// even when a database is there.
const available = (await startTestDatabase('rbac')) !== null;

beforeAll(async () => {
  if (!available) return;
  app = createApp();
  await seed({ reset: true });
}, 180_000);

afterAll(async () => {
  if (available) await stopTestDatabase();
});

async function signIn(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  expect(response.status, `login for ${email}: ${JSON.stringify(response.body)}`).toBe(200);
  return response.body.accessToken as string;
}

const RUN = () => (available ? describe : describe.skip);

RUN()('authentication', () => {
  it('signs in each seeded role', async () => {
    for (const email of [
      'admin@nova.example.com',
      'ravi@nova.example.com',
      'cfo@nova.example.com',
      'payroll@nova.example.com',
      'auditor@nova.example.com',
    ]) {
      await expect(signIn(email)).resolves.toBeTruthy();
    }
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ravi@nova.example.com', password: 'not-the-password' });
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@nova.example.com', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it('derives permissions from roles rather than from the token', async () => {
    const token = await signIn('ravi@nova.example.com');
    const me = await request(app).get('/api/auth/me').set('authorization', `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.roleKeys).toEqual([RoleKey.FINANCE_EXECUTIVE]);
    expect(me.body.permissions).toContain('invoice:read');
    expect(me.body.permissions).not.toContain('invoice:approve');
  });
});

/**
 * Invitation flow.
 *
 * This shipped broken: an admin-created account was given status INVITED and a
 * temporary password, but login refuses any status other than ACTIVE and no
 * route existed to change it — the user was permanently locked out.
 */
RUN()('invitations', () => {
  const email = 'newcomer@nova.example.com';
  let inviteUrl: string;

  it('creates an invited account that cannot yet sign in', async () => {
    const admin = await signIn('companyadmin@nova.example.com');

    const created = await request(app)
      .post('/api/settings/users')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Newcomer', email, roleKeys: [RoleKey.FINANCE_EXECUTIVE], companyIds: [] });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe('INVITED');
    expect(created.body.inviteToken).toBeTruthy();
    inviteUrl = created.body.inviteUrl as string;

    // Confirms the account really is unusable until the invite is redeemed.
    const attempt = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'AnythingAtAll1' });
    expect(attempt.status).not.toBe(200);
  });

  it('activates the account when the invitation is accepted, and signs them in', async () => {
    const token = new URL(inviteUrl, 'http://localhost').searchParams.get('token')!;

    const accepted = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token, password: 'BrandNewPass1' });

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.accessToken).toBeTruthy();
    expect(accepted.body.user.email).toBe(email);

    // The password now works through the normal login route.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'BrandNewPass1' });
    expect(login.status).toBe(200);
  });

  it('refuses to let the same invitation be redeemed twice', async () => {
    const token = new URL(inviteUrl, 'http://localhost').searchParams.get('token')!;
    const replay = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token, password: 'AnotherPass1' });
    expect(replay.status).toBe(400);
  });

  it('rejects an unknown token', async () => {
    const response = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token: 'x'.repeat(40), password: 'BrandNewPass1' });
    expect(response.status).toBe(400);
  });

  it('activates the account when an admin sets a password directly', async () => {
    const admin = await signIn('companyadmin@nova.example.com');
    const second = 'seconduser@nova.example.com';

    const created = await request(app)
      .post('/api/settings/users')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Second', email: second, roleKeys: [RoleKey.AUDITOR], companyIds: [] });
    expect(created.status).toBe(201);

    // Setting a password has to unlock the account; otherwise the admin hands
    // over credentials that login still refuses.
    const patched = await request(app)
      .patch(`/api/settings/users/${created.body.id}`)
      .set('authorization', `Bearer ${admin}`)
      .send({ password: 'AdminChosen1' });
    expect(patched.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: second, password: 'AdminChosen1' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });
});

/**
 * The role/route matrix. Each row is a real PRD requirement, not a
 * mechanical enumeration.
 */
RUN()('permission matrix', () => {
  const cases: Array<{
    who: string;
    email: string;
    method: 'get' | 'post';
    path: string;
    expected: number;
    why: string;
  }> = [
    {
      who: 'Finance Executive',
      email: 'ravi@nova.example.com',
      method: 'get',
      path: '/api/payroll',
      expected: 403,
      why: 'salary data is not visible to ordinary AP users (PRD §18)',
    },
    {
      who: 'Finance Executive',
      email: 'ravi@nova.example.com',
      method: 'get',
      path: '/api/invoices',
      expected: 200,
      why: 'reviewing invoices is their job (PRD §7)',
    },
    {
      who: 'Finance Executive',
      email: 'ravi@nova.example.com',
      method: 'get',
      path: '/api/banking/statements',
      expected: 200,
      why: 'they upload bank statements (PRD §7)',
    },
    {
      who: 'Finance Executive',
      email: 'ravi@nova.example.com',
      method: 'get',
      path: '/api/settings/users',
      expected: 403,
      why: 'they cannot change organisation settings (PRD §7)',
    },
    {
      who: 'Payroll User',
      email: 'payroll@nova.example.com',
      method: 'get',
      path: '/api/payroll',
      expected: 200,
      why: 'payroll is their module',
    },
    {
      who: 'Payroll User',
      email: 'payroll@nova.example.com',
      method: 'get',
      path: '/api/invoices',
      expected: 403,
      why: 'payroll staff have no reason to see vendor invoices',
    },
    {
      who: 'CFO',
      email: 'cfo@nova.example.com',
      method: 'get',
      path: '/api/payroll',
      expected: 200,
      why: 'the CFO approves payroll (PRD §19)',
    },
    {
      who: 'CFO',
      email: 'cfo@nova.example.com',
      method: 'get',
      path: '/api/audit',
      expected: 200,
      why: 'the CFO must be able to see who did what (PRD §45)',
    },
    {
      who: 'Auditor',
      email: 'auditor@nova.example.com',
      method: 'get',
      path: '/api/audit',
      expected: 200,
      why: 'read-only access to the audit trail is the role',
    },
    {
      who: 'Auditor',
      email: 'auditor@nova.example.com',
      method: 'post',
      path: '/api/payments/batches',
      expected: 403,
      why: 'the auditor must never be able to move money',
    },
    {
      who: 'Approver',
      email: 'ithead@nova.example.com',
      method: 'get',
      path: '/api/approvals',
      expected: 200,
      why: 'they need their approvals inbox',
    },
    {
      who: 'Approver',
      email: 'ithead@nova.example.com',
      method: 'get',
      path: '/api/banking/transactions',
      expected: 403,
      why: 'an approver has no banking access',
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.who} → ${testCase.method.toUpperCase()} ${testCase.path} is ${testCase.expected} (${testCase.why})`, async () => {
      const token = await signIn(testCase.email);
      const response = await request(app)
        [testCase.method](testCase.path)
        .set('authorization', `Bearer ${token}`)
        .send({});
      expect(response.status).toBe(testCase.expected);
    });
  }
});

RUN()('payroll confidentiality', () => {
  it('shows payroll as one aggregate line to a caller without payroll access', async () => {
    const cfoToken = await signIn('cfo@nova.example.com');
    const raviToken = await signIn('ravi@nova.example.com');

    const asCfo = await request(app)
      .get('/api/payments/queue')
      .set('authorization', `Bearer ${cfoToken}`);
    const asExecutive = await request(app)
      .get('/api/payments/queue')
      .set('authorization', `Bearer ${raviToken}`);

    expect(asCfo.status).toBe(200);
    expect(asExecutive.status).toBe(200);
    // The executive's response is explicitly marked as aggregated, and no row
    // carries a beneficiary account for a payroll line.
    expect(asExecutive.body.payrollAggregated).toBe(true);
    for (const item of asExecutive.body.items as Array<Record<string, unknown>>) {
      if (item.type === 'PAYROLL') expect(item.beneficiaryAccount).toBeNull();
    }
  });

  it('keeps payroll out of the executive dashboard totals, and says so', async () => {
    const token = await signIn('ravi@nova.example.com');
    const response = await request(app)
      .get('/api/dashboard')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.payroll).toBeNull();
    expect(response.body.payrollHidden).toBe(true);
    expect(response.body.cash.payrollExcluded).toBe(true);
    expect(response.body.cash.approvedPayroll).toBe(0);
  });
});

RUN()('audit trail', () => {
  it('records a login and refuses to let it be altered', async () => {
    await signIn('ravi@nova.example.com');
    const auditorToken = await signIn('auditor@nova.example.com');

    const response = await request(app)
      .get('/api/audit')
      .query({ event: 'auth.login' })
      .set('authorization', `Bearer ${auditorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);

    // There is deliberately no route that mutates audit records.
    const { AuditEvent } = await import('./models/auditEvent.model.js');
    const record = await AuditEvent.findOne({ event: 'auth.login' });
    await expect(AuditEvent.updateOne({ _id: record!._id }, { event: 'tampered' })).rejects.toThrow(
      /append-only/i,
    );
    await expect(AuditEvent.deleteOne({ _id: record!._id })).rejects.toThrow(/append-only/i);
  });
});

RUN()('custom roles', () => {
  /**
   * A role a tenant defines has to be enforced by the same middleware as a
   * built-in one — otherwise the settings screen would hand out grants the API
   * quietly ignores.
   */
  it('creates a role, grants it to a user, and enforces exactly its permissions', async () => {
    const adminToken = await signIn('admin@nova.example.com');

    const created = await request(app)
      .post('/api/settings/roles')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Invoice Clerk',
        description: 'Files invoices, sees nothing else',
        permissions: ['invoice:read', 'dashboard:read', 'notification:read'],
      });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.key).toBe('INVOICE_CLERK');
    expect(created.body.system).toBe(false);
    expect(created.body.permissionCount).toBe(3);

    const invited = await request(app)
      .post('/api/settings/users')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Nikhil Das',
        email: 'clerk@nova.example.com',
        password: DEMO_PASSWORD,
        roleKeys: ['INVOICE_CLERK'],
        companyIds: [],
        locationIds: [],
        departmentIds: [],
      });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);

    const clerkToken = await signIn('clerk@nova.example.com');
    const me = await request(app).get('/api/auth/me').set('authorization', `Bearer ${clerkToken}`);

    expect(me.status).toBe(200);
    expect(me.body.roleKeys).toEqual(['INVOICE_CLERK']);
    expect([...me.body.permissions].sort()).toEqual(
      ['dashboard:read', 'invoice:read', 'notification:read'].sort(),
    );

    // Granted, so allowed; never granted, so refused.
    const invoices = await request(app)
      .get('/api/invoices')
      .set('authorization', `Bearer ${clerkToken}`);
    const payroll = await request(app)
      .get('/api/payroll')
      .set('authorization', `Bearer ${clerkToken}`);

    expect(invoices.status).toBe(200);
    expect(payroll.status).toBe(403);
  });

  it('applies an edited grant on the next request', async () => {
    const adminToken = await signIn('admin@nova.example.com');
    const catalogue = await request(app)
      .get('/api/settings/roles')
      .set('authorization', `Bearer ${adminToken}`);
    const clerk = (catalogue.body.items as Array<Record<string, unknown>>).find(
      (role) => role.key === 'INVOICE_CLERK',
    );
    expect(clerk).toBeDefined();

    const clerkToken = await signIn('clerk@nova.example.com');
    expect(
      (await request(app).get('/api/audit').set('authorization', `Bearer ${clerkToken}`)).status,
    ).toBe(403);

    const updated = await request(app)
      .patch(`/api/settings/roles/${clerk!.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ permissions: ['invoice:read', 'dashboard:read', 'notification:read', 'audit:read'] });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);

    // The same access token, now carrying the wider grant: permissions are
    // resolved per request rather than frozen into the token.
    expect(
      (await request(app).get('/api/audit').set('authorization', `Bearer ${clerkToken}`)).status,
    ).toBe(200);
  });

  it('lists built-in roles as read-only alongside the tenant’s own', async () => {
    const token = await signIn('admin@nova.example.com');
    const response = await request(app)
      .get('/api/settings/roles')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const items = response.body.items as Array<Record<string, unknown>>;
    const builtIn = items.find((role) => role.key === RoleKey.CFO);
    const custom = items.find((role) => role.key === 'INVOICE_CLERK');

    expect(builtIn).toMatchObject({ system: true });
    expect(builtIn?.id).toBeUndefined();
    expect(custom).toMatchObject({ system: false, userCount: 1 });
  });

  it('refuses to delete a role someone still holds, and refuses built-in keys', async () => {
    const token = await signIn('admin@nova.example.com');
    const catalogue = await request(app)
      .get('/api/settings/roles')
      .set('authorization', `Bearer ${token}`);
    const clerk = (catalogue.body.items as Array<Record<string, unknown>>).find(
      (role) => role.key === 'INVOICE_CLERK',
    );

    const held = await request(app)
      .delete(`/api/settings/roles/${clerk!.id}`)
      .set('authorization', `Bearer ${token}`);
    expect(held.status).toBe(409);

    const collision = await request(app)
      .post('/api/settings/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ label: 'CFO', permissions: ['invoice:read'] });
    expect(collision.status).toBe(409);
  });

  it('will not let a user be given a role that does not exist', async () => {
    const token = await signIn('admin@nova.example.com');
    const response = await request(app)
      .post('/api/settings/users')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: 'Ghost',
        email: 'ghost@nova.example.com',
        password: DEMO_PASSWORD,
        roleKeys: ['NO_SUCH_ROLE'],
        companyIds: [],
        locationIds: [],
        departmentIds: [],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/NO_SUCH_ROLE/);
  });

  it('keeps role creation to the administrators who hold the permission', async () => {
    const token = await signIn('ravi@nova.example.com');
    const response = await request(app)
      .post('/api/settings/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ label: 'Self Promotion', permissions: ['invoice:approve'] });

    expect(response.status).toBe(403);
  });
});

if (!available) {
  // Surfaces the reason once, so a skipped suite is never mistaken for a pass.
  console.warn(`[rbac.integration] skipped — ${databaseSkipReason() ?? 'no database'}`);
}
