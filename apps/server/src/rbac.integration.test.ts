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
let available = false;

beforeAll(async () => {
  const uri = await startTestDatabase();
  if (!uri) return;
  available = true;
  app = createApp();
  await seed({ reset: true });
}, 120_000);

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
    await expect(
      AuditEvent.updateOne({ _id: record!._id }, { event: 'tampered' }),
    ).rejects.toThrow(/append-only/i);
    await expect(AuditEvent.deleteOne({ _id: record!._id })).rejects.toThrow(/append-only/i);
  });
});

if (!available) {
  // Surfaces the reason once, so a skipped suite is never mistaken for a pass.
  // eslint-disable-next-line no-console
  console.warn(`[rbac.integration] skipped — ${databaseSkipReason() ?? 'no database'}`);
}
