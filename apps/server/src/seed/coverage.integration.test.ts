import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvoiceStatus,
  PayrollBatchStatus,
  ReconciliationStatus,
  ValidationCode,
} from '@fpc/shared';
import { BankTransaction } from '../models/banking.model.js';
import { Invoice } from '../models/invoice.model.js';
import { Notification } from '../models/notification.model.js';
import { PaymentBatch } from '../models/paymentBatch.model.js';
import { PaymentObligation } from '../models/paymentObligation.model.js';
import { PayrollBatch } from '../models/payroll.model.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { AuditEvent } from '../models/auditEvent.model.js';
import { DocumentFile } from '../models/documentFile.model.js';
import { registerNotificationHandlers } from '../modules/notifications/notification.service.js';
import { databaseSkipReason, startTestDatabase, stopTestDatabase } from '../test/db.js';
import { seed } from './seed.js';

/**
 * The coverage contract.
 *
 * "The seed covers every use case" is the kind of claim that quietly stops
 * being true the first time someone adds a status. These assertions make the
 * next such change fail loudly instead.
 *
 * Values deliberately absent are listed with the reason. Each is a state the
 * product cannot rest in, so seeding one would fabricate something a user
 * could never reach:
 *
 *   InvoiceStatus.EXTRACTING          transient inside `runExtraction`
 *   InvoiceStatus.VALIDATED/SUBMITTED transient inside the submit handler
 *   InvoiceStatus.PAID                `settleInvoice` moves straight on to
 *                                     RECONCILED in the same call
 *   PaymentBatchStatus.READY/EXPORTED `exportBatch` walks DRAFT to PROCESSING
 *                                     in one call
 *   PaymentBatchStatus.COMPLETED      no route produces it
 *   PaymentBatchStatus.CANCELLED      no route cancels a batch
 *   PaymentStatus.PENDING/FAILED/CANCELLED   never assigned anywhere
 *   PayrollBatchStatus.REJECTED       reachable, but only as a month that was
 *                                     never paid; the period index means it
 *                                     could not then be re-run, so seeding one
 *                                     would leave incoherent history
 */

// Connected at module scope, not in `beforeAll`: vitest collects the suites —
// and so evaluates `RUN()` — before any hook runs.
const available = (await startTestDatabase('seed-coverage')) !== null;
const RUN = () => (available ? describe : describe.skip);

beforeAll(async () => {
  if (!available) return;
  registerNotificationHandlers();
  await seed({ reset: true });
}, 180_000);

afterAll(async () => {
  await stopTestDatabase();
});

RUN()('seed coverage', () => {
  it('puts an invoice in every status the product can rest in', async () => {
    const statuses = await Invoice.distinct('status');
    expect(statuses).toEqual(
      expect.arrayContaining([
        InvoiceStatus.RECEIVED,
        InvoiceStatus.REVIEW_REQUIRED,
        InvoiceStatus.PENDING_APPROVAL,
        InvoiceStatus.APPROVED,
        InvoiceStatus.PAYMENT_PENDING,
        InvoiceStatus.PAYMENT_BATCHED,
        InvoiceStatus.PAYMENT_PROCESSING,
        InvoiceStatus.RECONCILED,
        InvoiceStatus.REJECTED,
        InvoiceStatus.DUPLICATE,
        InvoiceStatus.CANCELLED,
        InvoiceStatus.FAILED,
      ]),
    );
  });

  it('fills all four reconciliation tabs', async () => {
    const statuses = await BankTransaction.distinct('reconciliationStatus');
    expect(statuses).toEqual(
      expect.arrayContaining([
        ReconciliationStatus.MATCHED,
        ReconciliationStatus.SUGGESTED,
        ReconciliationStatus.UNMATCHED,
        ReconciliationStatus.IGNORED,
      ]),
    );
  });

  it('rests a payment batch in each reachable status', async () => {
    const statuses = await PaymentBatch.distinct('status');
    expect(statuses).toEqual(
      expect.arrayContaining(['DRAFT', 'PROCESSING', 'PARTIALLY_RECONCILED', 'RECONCILED']),
    );
  });

  it('covers the obligation payment statuses the product assigns', async () => {
    const statuses = await PaymentObligation.distinct('paymentStatus');
    expect(statuses).toEqual(
      expect.arrayContaining(['QUEUED', 'BATCHED', 'PROCESSING', 'PAID', 'ON_HOLD']),
    );
  });

  it('has both kinds of obligation', async () => {
    expect(await PaymentObligation.distinct('type')).toEqual(
      expect.arrayContaining(['VENDOR', 'PAYROLL']),
    );
  });

  it('runs payroll through review, approval and full reconciliation', async () => {
    const statuses = await PayrollBatch.distinct('status');
    expect(statuses).toEqual(
      expect.arrayContaining([
        PayrollBatchStatus.VALIDATED,
        PayrollBatchStatus.REVIEW_REQUIRED,
        PayrollBatchStatus.PAYMENT_PENDING,
        PayrollBatchStatus.RECONCILED,
      ]),
    );
  });

  it('leaves the flagship demos unfinished', async () => {
    const invoice = await Invoice.findOne({ invoiceNumber: 'INV-9821' }).lean();
    expect(invoice?.status).toBe(InvoiceStatus.REVIEW_REQUIRED);

    const payroll = await PayrollBatch.findOne({ employeeCount: 850 }).lean();
    expect(payroll?.status).toBe(PayrollBatchStatus.VALIDATED);
    // The month-on-month figure comes from a real prior batch, not a constant.
    expect(payroll?.previousBatchId).toBeTruthy();
  });

  it('covers every vendor and user status', async () => {
    expect(await Vendor.distinct('status')).toEqual(
      expect.arrayContaining(['ACTIVE', 'INACTIVE', 'BLOCKED']),
    );
    expect(await User.distinct('status')).toEqual(
      expect.arrayContaining(['ACTIVE', 'INVITED', 'SUSPENDED']),
    );
  });

  it('seeds the tenant custom roles, and grants one to a user', async () => {
    const roles = await Role.find().select('key').lean();
    expect(roles.map((role) => role.key)).toEqual(
      expect.arrayContaining(['AP_CLERK', 'TREASURY_VIEWER']),
    );
    // Never INVOICE_CLERK: the RBAC suite creates that key itself.
    expect(roles.map((role) => role.key)).not.toContain('INVOICE_CLERK');

    expect(await User.countDocuments({ roleKeys: 'AP_CLERK' })).toBeGreaterThan(0);
  });

  it('produces every validation code the invoice validator can raise', async () => {
    const invoices = await Invoice.find({ 'findings.0': { $exists: true } })
      .select('findings')
      .lean();
    const codes = new Set(invoices.flatMap((entry) => entry.findings.map((f) => f.code)));

    // MISSING_VENDOR_BANK_DETAILS is raised by the payroll importer, not by
    // invoice validation, and is asserted on the payroll batch below.
    for (const code of Object.values(ValidationCode)) {
      if (code === ValidationCode.MISSING_VENDOR_BANK_DETAILS) continue;
      expect(codes, `no seeded invoice carries ${code}`).toContain(code);
    }

    const payroll = await PayrollBatch.findOne({
      'findings.code': ValidationCode.MISSING_VENDOR_BANK_DETAILS,
    }).lean();
    expect(payroll).toBeTruthy();
  });

  it('gives both companies something to work with', async () => {
    const byCompany = await Invoice.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: '$companyId', count: { $sum: 1 } } },
    ]);
    expect(byCompany).toHaveLength(2);
    for (const entry of byCompany) expect(entry.count).toBeGreaterThan(0);
  });

  it('leaves no two batched payments close enough to confuse the matcher', async () => {
    // `bestMatch` returns nothing when the runner-up is within five points, so
    // two open payments of a similar size silently break the demo.
    const open = await PaymentObligation.find({
      paymentStatus: { $in: ['BATCHED', 'PROCESSING'] },
      reconciliationStatus: { $ne: 'MATCHED' },
      type: 'VENDOR',
    })
      .select('amount companyId reference')
      .lean();

    for (const a of open) {
      for (const b of open) {
        if (a.reference === b.reference) continue;
        if (String(a.companyId) !== String(b.companyId)) continue;
        const window = Math.max(100, Math.round(a.amount * 0.005));
        expect(
          Math.abs(a.amount - b.amount),
          `${a.reference} and ${b.reference} are within the matcher's window`,
        ).toBeGreaterThan(window);
      }
    }
  });

  it('attaches a real document to every invoice that has been extracted', async () => {
    const missing = await Invoice.countDocuments({
      status: { $ne: InvoiceStatus.RECEIVED },
      documentFileId: { $exists: false },
    });
    expect(missing).toBe(0);
    expect(await DocumentFile.countDocuments({ kind: 'INVOICE' })).toBeGreaterThan(0);
    expect(await DocumentFile.countDocuments({ kind: 'PAYROLL_IMPORT' })).toBeGreaterThan(0);
    expect(await DocumentFile.countDocuments({ kind: 'BANK_FILE' })).toBeGreaterThan(0);
  });

  it('leaves notifications and an attributed audit trail behind', async () => {
    expect(await Notification.countDocuments()).toBeGreaterThan(0);
    // The email queue is drained, or the demo's own mail would never be sent:
    // `dispatchPendingEmails` only takes the oldest fifty.
    expect(await Notification.countDocuments({ channel: 'EMAIL', status: 'PENDING' })).toBe(0);
    // A handful of unread items, not forty.
    const unread = await Notification.countDocuments({ channel: 'IN_APP', status: 'PENDING' });
    expect(unread).toBeGreaterThan(0);
    expect(unread).toBeLessThan(20);

    expect(await AuditEvent.countDocuments({ userName: { $exists: true } })).toBeGreaterThan(0);
    expect(await AuditEvent.countDocuments({ event: 'auth.login' })).toBeGreaterThan(0);
  });
});

if (!available) {
  console.warn(`[seed coverage] skipped — ${databaseSkipReason() ?? 'no database'}`);
}
