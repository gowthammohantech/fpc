import { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { ApprovalRequest } from '../models/approvalRequest.model.js';
import { ApprovalRule } from '../models/approvalRule.model.js';
import { AuditEvent } from '../models/auditEvent.model.js';
import { BankAccount } from '../models/bankAccount.model.js';
import { BankStatement, BankTransaction, Reconciliation } from '../models/banking.model.js';
import { Company } from '../models/company.model.js';
import { Department } from '../models/department.model.js';
import { DocumentFile } from '../models/documentFile.model.js';
import { Invoice } from '../models/invoice.model.js';
import { Location } from '../models/location.model.js';
import { Notification } from '../models/notification.model.js';
import { PaymentBatch, PaymentBatchItem } from '../models/paymentBatch.model.js';
import { PaymentObligation } from '../models/paymentObligation.model.js';
import { PayrollBatch, PayrollEmployee } from '../models/payroll.model.js';
import { Role } from '../models/role.model.js';
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { invalidateRoleCache } from '../modules/organization/role.service.js';
import { publishSeededEvents, seedAuditHistory, settleNotifications } from './history.seed.js';
import { seedInvoices } from './invoices.seed.js';
import { seedOrganization } from './organization.seed.js';
import { seedHeldObligation, seedPaymentClusters, seedSettledPayment } from './payments.seed.js';
import { seedPayroll } from './payroll.seed.js';
import { seedReconciliation } from './reconciliation.seed.js';
import { COMPANIES, ROLES, USERS, VENDORS } from './data.org.js';
import { APPROVAL_RULES } from './data.approvals.js';

export interface SeedResult {
  tenantId: Types.ObjectId;
  companyIds: Record<string, Types.ObjectId>;
  userIds: Record<string, Types.ObjectId>;
  summary: Record<string, number>;
}

export interface SeedOptions {
  reset?: boolean;
  /**
   * Seed last month's fully settled payroll run. It is the most expensive part
   * of the seed by a wide margin, so local iteration can turn it off.
   */
  payrollHistory?: boolean;
}

/**
 * Builds the demo dataset.
 *
 * Two things it deliberately does not do. It does not finish either flagship
 * journey: the TechZone invoice is left awaiting review and this month's
 * payroll awaiting approval, so the demo walks them through rather than
 * presenting a finished state. And it never writes a status the product could
 * not have produced — every settled payment is a complete chain ending in a
 * confirmed bank match, because that is the only way the product reaches PAID.
 *
 * Everything else is driven through the real services, so the approval chains,
 * audit trail, notifications and documents that go with each row exist too.
 */
export async function seed(options: SeedOptions = {}): Promise<SeedResult> {
  if (options.reset) await clear();

  const context = await seedOrganization();

  const invoices = await seedInvoices(context);
  const clusters = await seedPaymentClusters(context);
  const settled = await seedSettledPayment(context);
  const transactions = await seedReconciliation(context, clusters.batchIds.partial);
  await seedHeldObligation(context);

  const payroll = await seedPayroll(context, { history: options.payrollHistory ?? true });

  await publishSeededEvents(context);
  await settleNotifications(context);
  const auditEvents = await seedAuditHistory(context);

  const summary = {
    companies: COMPANIES.length,
    users: USERS.length,
    customRoles: ROLES.length,
    vendors: VENDORS.length,
    approvalRules: APPROVAL_RULES.length,
    invoices,
    paymentBatches: clusters.batches + settled,
    bankTransactions: transactions,
    payrollBatches: payroll.batches,
    payrollEmployees: payroll.employees,
    auditEvents,
  };

  logger.info(summary, 'seed complete');
  return {
    tenantId: context.tenantId,
    companyIds: context.companyIds,
    userIds: Object.fromEntries(
      Object.entries(context.users).map(([email, seeded]) => [email, seeded.id]),
    ),
    summary,
  };
}

/**
 * Wipes every collection. Used by `pnpm seed --reset` and by tests.
 *
 * Blobs in local storage are left alone: keys are namespaced by record id, so
 * a re-seed never collides with them, and deleting a shared container is a
 * much worse failure mode than leaving a few orphaned files behind.
 */
export async function clear(): Promise<void> {
  await Promise.all([
    Tenant.deleteMany({}),
    Company.deleteMany({}),
    Location.deleteMany({}),
    Department.deleteMany({}),
    User.deleteMany({}),
    // Custom roles are rows. Without this a --reset left stale ones behind,
    // still granting permissions to accounts that no longer exist.
    Role.deleteMany({}),
    Vendor.deleteMany({}),
    BankAccount.deleteMany({}),
    Invoice.deleteMany({}),
    ApprovalRule.deleteMany({}),
    ApprovalRequest.deleteMany({}),
    PayrollBatch.deleteMany({}),
    PayrollEmployee.deleteMany({}),
    PaymentObligation.deleteMany({}),
    PaymentBatch.deleteMany({}),
    PaymentBatchItem.deleteMany({}),
    BankStatement.deleteMany({}),
    BankTransaction.deleteMany({}),
    Reconciliation.deleteMany({}),
    Notification.deleteMany({}),
    DocumentFile.deleteMany({}),
    // Audit is append-only through Mongoose, so drop the collection instead.
    AuditEvent.collection.drop().catch(() => undefined),
  ]);

  invalidateRoleCache();
}
