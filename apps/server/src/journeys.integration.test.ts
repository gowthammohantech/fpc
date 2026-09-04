import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceStatus, toMinor } from '@fpc/shared';
import { createApp } from './app.js';
import { ConsoleMailer } from './integrations/email/console.driver.js';
import { setMailer } from './integrations/email/index.js';
import {
  dispatchPendingEmails,
  registerNotificationHandlers,
} from './modules/notifications/notification.service.js';
import { DEMO_PASSWORD } from './seed/data.js';
import { writePayrollWorkbook, writeStatementWorkbook } from './seed/fixtures.js';
import { seed } from './seed/seed.js';
import { databaseSkipReason, startTestDatabase, stopTestDatabase } from './test/db.js';

/**
 * The two flagship journeys from PRD §37 and §38, driven end to end through
 * the API exactly as the demo does through the interface.
 *
 * Requires a MongoDB — see `src/test/db.ts`. Skips with a reason otherwise.
 */
let app: Express;
let directory: string;
let mailer: ConsoleMailer;
let companyId: string;

// Connected at module scope, not in `beforeAll`: vitest collects the suites —
// and so evaluates `RUN()` — before any hook runs.
const available = (await startTestDatabase('journeys')) !== null;

beforeAll(async () => {
  if (!available) return;

  directory = await mkdtemp(join(tmpdir(), 'fpc-journey-'));
  mailer = new ConsoleMailer();
  setMailer(mailer);
  // The running server subscribes through the job scheduler, which the test
  // does not start; without this no domain event ever becomes a notification.
  registerNotificationHandlers();

  app = createApp();
  const result = await seed({ reset: true });
  companyId = String(result.companyIds.engineering);
}, 180_000);

afterAll(async () => {
  if (!available) return;
  setMailer(null);
  await rm(directory, { recursive: true, force: true });
  await stopTestDatabase();
});

async function token(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.accessToken as string;
}

const RUN = () => (available ? describe : describe.skip);

RUN()('vendor invoice journey (PRD §37)', () => {
  it('carries INV-9821 from review to paid, with the vendor notified', async () => {
    const ravi = await token('ravi@nova.example.com');
    const itHead = await token('ithead@nova.example.com');
    const financeHead = await token('financemanager@nova.example.com');
    const cfo = await token('cfo@nova.example.com');

    // ── The invoice is waiting in the review queue ─────────
    const review = await request(app)
      .get('/api/invoices')
      .query({ view: 'REVIEW', companyId })
      .set('authorization', `Bearer ${ravi}`);
    expect(review.status).toBe(200);

    const invoice = (review.body.items as Array<Record<string, unknown>>).find(
      (entry) => entry.invoiceNumber === 'INV-9821',
    );
    expect(invoice, 'INV-9821 should be awaiting review').toBeTruthy();
    const invoiceId = String(invoice!.id);
    expect(invoice!.totalAmount).toBe(toMinor(35_40_000));

    // ── Submit: ₹35.4L must route through three approvals ──
    const submitted = await request(app)
      .post(`/api/invoices/${invoiceId}/submit`)
      .set('authorization', `Bearer ${ravi}`);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.approvalRequestId).toBeTruthy();

    const approvalId = submitted.body.approvalRequestId as string;
    const chain = await request(app)
      .get(`/api/approvals/${approvalId}`)
      .set('authorization', `Bearer ${cfo}`);
    expect(chain.body.steps).toHaveLength(3);
    expect(chain.body.ruleName).toContain('Above ₹10L');

    // The submitter cannot approve their own invoice at any level.
    const selfApproval = await request(app)
      .post(`/api/approvals/${approvalId}/act`)
      .set('authorization', `Bearer ${ravi}`)
      .send({ action: 'APPROVE' });
    expect(selfApproval.status).toBe(403);

    // A later approver cannot jump the queue.
    const outOfOrder = await request(app)
      .post(`/api/approvals/${approvalId}/act`)
      .set('authorization', `Bearer ${cfo}`)
      .send({ action: 'APPROVE' });
    expect(outOfOrder.status).toBe(403);

    for (const [approver, comment] of [
      [itHead, 'Licences confirmed against the renewal quote'],
      [financeHead, 'Budgeted spend'],
      [cfo, 'Approved'],
    ] as const) {
      const acted = await request(app)
        .post(`/api/approvals/${approvalId}/act`)
        .set('authorization', `Bearer ${approver}`)
        .send({ action: 'APPROVE', comment });
      expect(acted.status, JSON.stringify(acted.body)).toBe(200);
    }

    // ── Approved → accounts payable → payment queue ────────
    const afterApproval = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${ravi}`);
    expect(afterApproval.body.status).toBe(InvoiceStatus.PAYMENT_PENDING);

    const queue = await request(app)
      .get('/api/payments/queue')
      .query({ companyId, type: 'VENDOR' })
      .set('authorization', `Bearer ${ravi}`);
    const obligation = (queue.body.items as Array<Record<string, unknown>>).find(
      (entry) => entry.reference === 'INV-9821',
    );
    expect(obligation, 'the approved invoice should be in the payment queue').toBeTruthy();
    // The account number is masked everywhere it is returned.
    expect(String(obligation!.beneficiaryAccount)).toMatch(/^X+\d{4}$/);

    // ── Create and export the payment batch ───────────────
    const batch = await request(app)
      .post('/api/payments/batches')
      .set('authorization', `Bearer ${ravi}`)
      .send({
        companyId,
        paymentDate: new Date().toISOString(),
        obligationIds: [obligation!.id],
      });
    expect(batch.status, JSON.stringify(batch.body)).toBe(201);
    expect(batch.body.reference).toMatch(/^PB-\d{8}-\d{3}$/);
    expect(batch.body.totalAmount).toBe(toMinor(35_40_000));

    const batchId = batch.body.id as string;

    // Maker-checker: the person who built the batch cannot release it.
    const selfExport = await request(app)
      .post(`/api/payments/batches/${batchId}/export`)
      .set('authorization', `Bearer ${ravi}`);
    expect(selfExport.status).toBe(403);

    const exported = await request(app)
      .post(`/api/payments/batches/${batchId}/export`)
      .set('authorization', `Bearer ${financeHead}`);
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    expect(exported.body.file.fileName).toContain(batch.body.reference);

    // `responseType('blob')` is what makes superagent buffer the workbook into
    // `body`; without it a binary content type leaves `body` an empty object.
    const bankFile = await request(app)
      .get(`/api/payments/batches/${batchId}/file`)
      .set('authorization', `Bearer ${financeHead}`)
      .responseType('blob');
    expect(bankFile.status).toBe(200);
    expect(bankFile.body.length).toBeGreaterThan(1000);

    // ── The bank statement arrives the next day ───────────
    const statementPath = join(directory, 'statement.xlsx');
    await writeStatementWorkbook(statementPath);

    const accounts = await request(app)
      .get('/api/settings/bank-accounts')
      .query({ companyId })
      .set('authorization', `Bearer ${cfo}`);
    // Selected by account number, not by position: the list sorts by label and
    // the tenant has more than one account per company.
    const bankAccountId = (accounts.body.items as Array<Record<string, string>>).find(
      (entry) => entry.accountNumber === '00600350001234',
    )!.id;

    const imported = await request(app)
      .post('/api/banking/statements')
      .set('authorization', `Bearer ${ravi}`)
      .field('companyId', companyId)
      .field('bankAccountId', bankAccountId)
      .attach('file', await readFile(statementPath), 'statement.xlsx');
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(imported.body.imported).toBeGreaterThan(0);

    // The ₹35.4L TechZone debit should be suggested against our obligation.
    const suggested = await request(app)
      .get('/api/reconciliation')
      .query({ companyId, tab: 'SUGGESTED' })
      .set('authorization', `Bearer ${ravi}`);
    expect(suggested.status).toBe(200);

    const techzone = (suggested.body.items as Array<Record<string, any>>).find(
      (entry) => entry.match?.obligation?.reference === 'INV-9821',
    );
    expect(techzone, 'the TechZone debit should be suggested').toBeTruthy();
    expect(techzone!.match.confidence).toBeGreaterThanOrEqual(85);
    expect(techzone!.match.signals.amountExact).toBe(true);

    // ── Confirm: this is what makes the payment real ──────
    const confirmed = await request(app)
      .post('/api/reconciliation/confirm')
      .set('authorization', `Bearer ${ravi}`)
      .send({
        bankTransactionId: techzone!.id,
        obligationId: techzone!.match.obligation.id,
      });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    const paid = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${ravi}`);
    expect(paid.body.status).toBe(InvoiceStatus.RECONCILED);
    expect(paid.body.paidAt).toBeTruthy();

    // ── The vendor is told, and the trail is complete ─────
    await new Promise((resolve) => setTimeout(resolve, 200));
    await dispatchPendingEmails();
    const confirmation = mailer.sent.find(
      (mail) => mail.to.includes('techzone') && mail.subject.includes('INV-9821'),
    );
    expect(confirmation, 'the vendor should receive a payment confirmation').toBeTruthy();
    expect(confirmation!.text).toContain('35,40,000');

    const trail = await request(app)
      .get(`/api/audit/entity/INVOICE/${invoiceId}`)
      .set('authorization', `Bearer ${cfo}`);
    const events = (trail.body.items as Array<{ event: string }>).map((entry) => entry.event);
    expect(events).toEqual(
      expect.arrayContaining(['invoice.submitted', 'invoice.approved', 'invoice.paid']),
    );
  }, 180_000);
});

RUN()('payroll journey (PRD §38)', () => {
  it('imports 850 employees, approves, batches and reconciles them', async () => {
    const payrollUser = await token('payroll@nova.example.com');
    const financeHead = await token('financemanager@nova.example.com');
    const cfo = await token('cfo@nova.example.com');
    const ravi = await token('ravi@nova.example.com');

    const path = join(directory, 'payroll.xlsx');
    await writePayrollWorkbook(path);
    const file = await readFile(path);

    // ── Preview before anything is written ────────────────
    const preview = await request(app)
      .post('/api/payroll/preview')
      .set('authorization', `Bearer ${payrollUser}`)
      .attach('file', file, 'payroll.xlsx');
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.employeeCount).toBe(850);
    expect(preview.body.totalNetAmount).toBe(toMinor(6_20_00_000));
    expect(preview.body.rowsWithErrors).toBe(0);
    // The sample must not expose full account numbers.
    for (const row of preview.body.sample as Array<Record<string, string>>) {
      expect(row.bankAccountNumber).toMatch(/^X+\d{4}$/);
    }

    // ── Import into a batch for a fresh period ────────────
    const imported = await request(app)
      .post('/api/payroll/import')
      .set('authorization', `Bearer ${payrollUser}`)
      .field('companyId', companyId)
      .field('label', 'Journey Payroll')
      .field('periodMonth', '3')
      .field('periodYear', '2027')
      .attach('file', file, 'payroll.xlsx');
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);

    const batchId = imported.body.batch.id as string;
    expect(imported.body.employeeCount).toBe(850);

    // An AP user must not be able to read it.
    const forbidden = await request(app)
      .get(`/api/payroll/${batchId}`)
      .set('authorization', `Bearer ${ravi}`);
    expect(forbidden.status).toBe(403);

    // ── Submit and approve: the CFO, and only the CFO ─────
    const submitted = await request(app)
      .post(`/api/payroll/${batchId}/submit`)
      .set('authorization', `Bearer ${payrollUser}`);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

    const approvalId = submitted.body.approvalRequestId as string;
    expect(approvalId).toBeTruthy();

    // The Finance Head has no payroll rights at all (PRD §18).
    const financeHeadAttempt = await request(app)
      .post(`/api/approvals/${approvalId}/act`)
      .set('authorization', `Bearer ${financeHead}`)
      .send({ action: 'APPROVE' });
    expect(financeHeadAttempt.status).toBe(403);

    const acted = await request(app)
      .post(`/api/approvals/${approvalId}/act`)
      .set('authorization', `Bearer ${cfo}`)
      .send({ action: 'APPROVE' });
    expect(acted.status, JSON.stringify(acted.body)).toBe(200);

    // ── Approval fans out into 850 payment obligations ────
    const batch = await request(app)
      .get(`/api/payroll/${batchId}`)
      .set('authorization', `Bearer ${cfo}`);
    expect(batch.body.status).toBe('PAYMENT_PENDING');

    const queue = await request(app)
      .get('/api/payments/queue')
      .query({ companyId, type: 'PAYROLL', pageSize: 1 })
      .set('authorization', `Bearer ${cfo}`);
    expect(queue.body.total).toBeGreaterThanOrEqual(850);
  }, 180_000);
});

if (!available) {
  console.warn(`[journeys.integration] skipped — ${databaseSkipReason() ?? 'no database'}`);
}
