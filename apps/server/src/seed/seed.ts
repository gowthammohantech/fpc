import { Types } from 'mongoose';
import {
  ApprovalStatus,
  InvoiceStatus,
  PayrollBatchStatus,
  ValidationCode,
  ValidationSeverity,
  toMinor,
} from '@fpc/shared';
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
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { startApproval } from '../modules/approvals/approval.service.js';
import { createObligationForInvoice } from '../modules/payments/obligation.service.js';
import {
  APPROVAL_RULES,
  BANK_ACCOUNTS,
  COMPANIES,
  DEMO_PASSWORD,
  DEPARTMENTS,
  FIRST_NAMES,
  IFSC_CODES,
  INVOICES,
  LAST_NAMES,
  LOCATIONS,
  PAYROLL,
  TENANT,
  USERS,
  VENDORS,
} from './data.js';

export interface SeedResult {
  tenantId: Types.ObjectId;
  companyIds: Record<string, Types.ObjectId>;
  userIds: Record<string, Types.ObjectId>;
  summary: Record<string, number>;
}

/**
 * Builds the demo dataset for the PRD's two flagship journeys.
 *
 * Deliberately stops short of completing either journey: the TechZone invoice
 * is left awaiting review and the payroll batch awaiting approval, so the demo
 * itself walks them through the pipeline rather than presenting a finished
 * state. Data that already happened (a paid invoice, its statement line) is
 * seeded so the dashboard is not empty on first load.
 */
export async function seed(options: { reset?: boolean } = {}): Promise<SeedResult> {
  if (options.reset) await clear();

  const tenant = await Tenant.findOneAndUpdate(
    { slug: TENANT.slug },
    { ...TENANT, active: true },
    { upsert: true, new: true },
  );
  const tenantId = tenant._id;

  // ── Companies, locations, departments ────────────────────
  const companyIds: Record<string, Types.ObjectId> = {};
  for (const definition of COMPANIES) {
    const company = await Company.findOneAndUpdate(
      { tenantId, name: definition.name },
      { ...definition, tenantId, baseCurrency: 'INR', active: true },
      { upsert: true, new: true },
    );
    companyIds[definition.key] = company._id;
  }

  const locationIds: Record<string, Types.ObjectId> = {};
  for (const definition of LOCATIONS) {
    const companyId = companyIds[definition.company]!;
    const location = await Location.findOneAndUpdate(
      { tenantId, companyId, code: definition.code },
      { ...definition, tenantId, companyId, active: true },
      { upsert: true, new: true },
    );
    locationIds[definition.code] = location._id;
  }

  // ── Users ────────────────────────────────────────────────
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds: Record<string, Types.ObjectId> = {};
  for (const definition of USERS) {
    const user = await User.findOneAndUpdate(
      { tenantId, email: definition.email },
      {
        tenantId,
        name: definition.name,
        email: definition.email,
        passwordHash,
        roleKeys: definition.roles,
        companyIds: definition.companies.map((key) => companyIds[key]!),
        status: 'ACTIVE',
      },
      { upsert: true, new: true },
    );
    userIds[definition.email] = user._id;
  }

  // Departments carry a head, which the DEPARTMENT_HEAD approval step resolves.
  const departmentIds: Record<string, Types.ObjectId> = {};
  for (const definition of DEPARTMENTS) {
    const companyId = companyIds[definition.company]!;
    const department = await Department.findOneAndUpdate(
      { tenantId, companyId, code: definition.code },
      {
        tenantId,
        companyId,
        name: definition.name,
        code: definition.code,
        headUserId: definition.head ? userIds[definition.head] : undefined,
        active: true,
      },
      { upsert: true, new: true },
    );
    departmentIds[definition.code] = department._id;
  }

  // ── Vendors and bank accounts ────────────────────────────
  const vendorIds: Record<string, Types.ObjectId> = {};
  for (const definition of VENDORS) {
    const companyId = companyIds[definition.company]!;
    const vendor = await Vendor.findOneAndUpdate(
      { tenantId, companyId, code: definition.code },
      { ...definition, tenantId, companyId, status: 'ACTIVE' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    vendorIds[definition.code] = vendor._id;
  }

  const bankAccountIds: Record<string, Types.ObjectId> = {};
  for (const definition of BANK_ACCOUNTS) {
    const companyId = companyIds[definition.company]!;
    const account = await BankAccount.findOneAndUpdate(
      { tenantId, companyId, accountNumber: definition.accountNumber },
      { ...definition, tenantId, companyId, balanceAsOf: new Date(), active: true },
      { upsert: true, new: true },
    );
    bankAccountIds[definition.company] = account._id;
  }

  // ── Approval rules ───────────────────────────────────────
  for (const definition of APPROVAL_RULES) {
    const companyId = companyIds[definition.company]!;
    await ApprovalRule.findOneAndUpdate(
      { tenantId, companyId, name: definition.name },
      { ...definition, tenantId, companyId, active: true },
      { upsert: true, new: true },
    );
  }

  // ── Invoices ─────────────────────────────────────────────
  const ravi = userIds['ravi@nova.example.com']!;
  let invoiceCount = 0;

  for (const definition of INVOICES) {
    const companyId = companyIds[definition.company]!;
    const existing = await Invoice.findOne({
      tenantId,
      companyId,
      invoiceNumber: definition.invoiceNumber,
    });
    if (existing) continue;

    const invoiceDate = daysFromNow(-definition.daysAgo);
    const invoice = await Invoice.create({
      tenantId,
      companyId,
      locationId: locationIds[definition.location],
      departmentId: departmentIds[definition.department],
      vendorId: vendorIds[definition.vendor],
      vendorName: VENDORS.find((entry) => entry.code === definition.vendor)!.name,
      invoiceNumber: definition.invoiceNumber,
      invoiceDate,
      dueDate: daysFromNow(definition.dueInDays),
      currency: 'INR',
      subtotal: toMinor(definition.subtotal),
      taxAmount: toMinor(definition.tax),
      totalAmount: toMinor(definition.total),
      status: InvoiceStatus.RECEIVED,
      source: 'EMAIL',
      documentFileName: `${definition.invoiceNumber}.pdf`,
      receivedAt: invoiceDate,
      senderEmail: VENDORS.find((entry) => entry.code === definition.vendor)!.email,
      approvalStatus: ApprovalStatus.NOT_REQUIRED,
      // Confidences mirror the PRD §12 example, with one field left low so the
      // review screen has something to highlight.
      extraction: {
        fields: {
          invoiceNumber: { value: definition.invoiceNumber, confidence: 0.99, source: 'OCR' },
          vendorName: {
            value: VENDORS.find((entry) => entry.code === definition.vendor)!.name,
            confidence: 0.98,
            source: 'OCR',
          },
          totalAmount: { value: String(definition.total), confidence: 0.99, source: 'OCR' },
          invoiceDate: {
            value: invoiceDate.toISOString().slice(0, 10),
            confidence: 0.94,
            source: 'OCR',
          },
          taxAmount: { value: String(definition.tax), confidence: 0.81, source: 'OCR' },
        },
        lineItems: [],
        provider: 'seed',
        extractedAt: new Date().toISOString(),
        overallConfidence: 0.94,
      },
      findings: [
        {
          code: ValidationCode.LOW_CONFIDENCE_FIELD,
          severity: ValidationSeverity.INFO,
          message: 'taxAmount was extracted with 81% confidence — please verify',
          field: 'taxAmount',
        },
      ],
    });
    invoiceCount += 1;

    // Walk the invoice as far as its `stopAt`, using the real services so the
    // seeded state is reachable by the same code paths the product uses.
    invoice.status = InvoiceStatus.EXTRACTING;
    invoice.status = InvoiceStatus.REVIEW_REQUIRED;
    await invoice.save();
    if (definition.stopAt === 'REVIEW_REQUIRED') continue;

    invoice.status = InvoiceStatus.VALIDATED;
    invoice.status = InvoiceStatus.SUBMITTED;
    invoice.submittedBy = ravi;
    invoice.submittedAt = new Date();
    await invoice.save();

    const outcome = await startApproval(
      {
        tenantId,
        companyId,
        subjectType: 'VENDOR_INVOICE',
        subjectId: invoice._id,
        subjectLabel: `${invoice.vendorName} ${invoice.invoiceNumber}`,
        amount: invoice.totalAmount ?? 0,
        requestedByUserId: ravi,
        departmentId: invoice.departmentId,
        locationId: invoice.locationId,
        vendorId: invoice.vendorId,
      },
      {},
    );

    if (outcome.request) {
      invoice.status = InvoiceStatus.PENDING_APPROVAL;
      invoice.approvalRequestId = outcome.request._id;
      invoice.approvalStatus = ApprovalStatus.IN_PROGRESS;
      await invoice.save();
    }
    if (definition.stopAt === 'PENDING_APPROVAL') continue;

    // Fully approve: mark every step approved and move the invoice on.
    if (outcome.request) {
      await ApprovalRequest.updateOne(
        { _id: outcome.request._id },
        {
          status: ApprovalStatus.APPROVED,
          completedAt: new Date(),
          $set: { 'steps.$[].status': 'APPROVED', 'steps.$[].actedAt': new Date() },
        },
      );
    }
    invoice.status = InvoiceStatus.APPROVED;
    invoice.approvalStatus = ApprovalStatus.APPROVED;
    await invoice.save();

    await createObligationForInvoice(invoice._id, {});
  }

  // ── Payroll ──────────────────────────────────────────────
  const payrollCompanyId = companyIds[PAYROLL.company]!;
  const period = previousMonth();
  let payrollBatchId: Types.ObjectId | null = null;

  const existingPayroll = await PayrollBatch.findOne({
    tenantId,
    companyId: payrollCompanyId,
    periodMonth: period.month,
    periodYear: period.year,
  });

  if (!existingPayroll) {
    const employees = buildPayrollEmployees();
    const total = employees.reduce((sum, employee) => sum + employee.netAmount, 0);

    const batch = await PayrollBatch.create({
      tenantId,
      companyId: payrollCompanyId,
      reference: `PR-${period.year}${String(period.month).padStart(2, '0')}`,
      periodMonth: period.month,
      periodYear: period.year,
      label: `${period.name} ${period.year} Payroll`,
      status: PayrollBatchStatus.VALIDATED,
      employeeCount: employees.length,
      totalNetAmount: total,
      currency: 'INR',
      locationBreakdown: PAYROLL.locations.map((location) => ({
        locationId: locationIds[location.code],
        locationName: location.name,
        count: employees.filter((employee) => employee.locationName === location.name).length,
        amount: employees
          .filter((employee) => employee.locationName === location.name)
          .reduce((sum, employee) => sum + employee.netAmount, 0),
      })),
      previousTotalNetAmount: toMinor(PAYROLL.previousTotal),
      sourceFileName: `${period.name}-${period.year}-Payroll.xlsx`,
      findings: [],
      approvalStatus: ApprovalStatus.PENDING,
      importedBy: userIds['payroll@nova.example.com'],
    });
    payrollBatchId = batch._id;

    await PayrollEmployee.insertMany(
      employees.map((employee, index) => ({
        tenantId,
        companyId: payrollCompanyId,
        payrollBatchId: batch._id,
        ...employee,
        locationId: locationIds[locationCodeFor(employee.locationName)],
        rowNumber: index + 2,
        findings: [],
      })),
    );
  }

  // ── A completed payment, so the dashboard is not empty ───
  const settled = await seedSettledPayment({
    tenantId,
    companyId: companyIds.engineering!,
    bankAccountId: bankAccountIds.engineering!,
    createdBy: ravi,
    exportedBy: userIds['financemanager@nova.example.com']!,
  });

  const summary = {
    companies: COMPANIES.length,
    users: USERS.length,
    vendors: VENDORS.length,
    approvalRules: APPROVAL_RULES.length,
    invoices: invoiceCount,
    payrollEmployees: payrollBatchId ? PAYROLL.employeeCount : 0,
    settledPayments: settled,
  };

  logger.info(summary, 'seed complete');
  return { tenantId, companyIds, userIds, summary };
}

/**
 * Creates one invoice that has already been paid and reconciled, so the
 * dashboard, reports and audit trail have history on first load.
 */
async function seedSettledPayment(input: {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  createdBy: Types.ObjectId;
  exportedBy: Types.ObjectId;
}): Promise<number> {
  const { tenantId, companyId, bankAccountId } = input;
  const reference = 'INV-7702';

  if (await Invoice.exists({ tenantId, companyId, invoiceNumber: reference })) return 0;

  const vendor = await Vendor.findOne({ tenantId, companyId, code: 'ZENITH' }).lean();
  if (!vendor) return 0;

  const paidOn = daysFromNow(-8);
  const amount = toMinor(18_20_000);

  const invoice = await Invoice.create({
    tenantId,
    companyId,
    vendorId: vendor._id,
    vendorName: vendor.name,
    invoiceNumber: reference,
    invoiceDate: daysFromNow(-20),
    dueDate: daysFromNow(-9),
    currency: 'INR',
    subtotal: toMinor(15_42_373),
    taxAmount: toMinor(2_77_627),
    totalAmount: amount,
    status: InvoiceStatus.RECONCILED,
    source: 'UPLOAD',
    receivedAt: daysFromNow(-20),
    approvalStatus: ApprovalStatus.APPROVED,
    paidAt: paidOn,
    reconciledAt: paidOn,
    findings: [],
  });

  const batch = await PaymentBatch.create({
    tenantId,
    companyId,
    reference: `PB-${paidOn.toISOString().slice(0, 10).replace(/-/g, '')}-001`,
    paymentDate: paidOn,
    status: 'RECONCILED',
    bankAccountId,
    bankFileFormat: 'HDFC',
    itemCount: 1,
    totalAmount: amount,
    vendorAmount: amount,
    vendorCount: 1,
    payrollAmount: 0,
    payrollCount: 0,
    reconciledAmount: amount,
    reconciledCount: 1,
    exportFileName: 'PB-seed.xlsx',
    exportedAt: paidOn,
    exportedBy: input.exportedBy,
    createdBy: input.createdBy,
  });

  const obligation = await PaymentObligation.create({
    tenantId,
    companyId,
    type: 'VENDOR',
    sourceId: invoice._id,
    reference,
    payeeName: vendor.name,
    beneficiaryName: vendor.name,
    beneficiaryAccount: vendor.bankAccountNumber!,
    ifsc: vendor.ifsc!,
    amount,
    currency: 'INR',
    dueDate: invoice.dueDate,
    approvalStatus: ApprovalStatus.APPROVED,
    paymentStatus: 'PAID',
    reconciliationStatus: 'MATCHED',
    paymentBatchId: batch._id,
    paymentBatchReference: batch.reference,
    paidAt: paidOn,
    reconciledAt: paidOn,
  });

  invoice.obligationId = obligation._id;
  invoice.paymentBatchId = batch._id;
  await invoice.save();

  await PaymentBatchItem.create({
    tenantId,
    companyId,
    paymentBatchId: batch._id,
    obligationId: obligation._id,
    type: 'VENDOR',
    beneficiaryName: vendor.name,
    beneficiaryAccount: vendor.bankAccountNumber!,
    ifsc: vendor.ifsc!,
    amount,
    reference,
    reconciliationStatus: 'MATCHED',
  });

  const statement = await BankStatement.create({
    tenantId,
    companyId,
    bankAccountId,
    fileName: 'HDFC_Statement_seed.xlsx',
    status: 'PARSED',
    periodStart: daysFromNow(-10),
    periodEnd: daysFromNow(-7),
    transactionCount: 1,
    duplicateCount: 0,
    totalDebit: amount,
    totalCredit: 0,
    uploadedBy: input.createdBy,
  });

  const transaction = await BankTransaction.create({
    tenantId,
    companyId,
    bankAccountId,
    bankStatementId: statement._id,
    transactionDate: paidOn,
    description: `NEFT ${vendor.name.toUpperCase()}`,
    reference: batch.reference,
    direction: 'DEBIT',
    amount,
    reconciliationStatus: 'MATCHED',
    dedupeHash: `seed-${String(obligation._id)}`,
  });

  const reconciliation = await Reconciliation.create({
    tenantId,
    companyId,
    bankTransactionId: transaction._id,
    obligationId: obligation._id,
    paymentBatchId: batch._id,
    status: 'MATCHED',
    confidence: 97,
    method: 'AUTO_SUGGESTED',
    confirmedBy: input.createdBy,
    confirmedAt: paidOn,
  });

  obligation.bankTransactionId = transaction._id;
  await obligation.save();
  transaction.reconciliationId = reconciliation._id;
  await transaction.save();

  return 1;
}

function buildPayrollEmployees() {
  const employees: Array<{
    employeeCode: string;
    employeeName: string;
    bankAccountNumber: string;
    ifsc: string;
    netAmount: number;
    departmentName: string;
    locationName: string;
  }> = [];

  // Spread salaries deterministically around the mean so the total lands on
  // the PRD's ₹6.20 Cr rather than being random each run.
  const mean = Math.round(toMinor(PAYROLL.targetTotal) / PAYROLL.employeeCount);
  let index = 0;

  for (const location of PAYROLL.locations) {
    for (let i = 0; i < location.count; i += 1) {
      const offset = ((index % 11) - 5) * 1000_00;
      employees.push({
        employeeCode: `EMP${String(index + 1).padStart(4, '0')}`,
        employeeName: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[(index * 7) % LAST_NAMES.length]}`,
        bankAccountNumber: `501000${String(1000000 + index).slice(-7)}`,
        ifsc: IFSC_CODES[index % IFSC_CODES.length]!,
        netAmount: mean + offset,
        departmentName:
          index % 3 === 0 ? 'Engineering' : index % 3 === 1 ? 'Operations' : 'Finance',
        locationName: location.name,
      });
      index += 1;
    }
  }

  // Put the residual on the last row so the batch total is exact.
  const total = employees.reduce((sum, employee) => sum + employee.netAmount, 0);
  const residual = toMinor(PAYROLL.targetTotal) - total;
  employees[employees.length - 1]!.netAmount += residual;

  return employees;
}

function locationCodeFor(name: string): string {
  return PAYROLL.locations.find((location) => location.name === name)?.code ?? '';
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function previousMonth(): { month: number; year: number; name: string } {
  const now = new Date();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const name = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][month - 1]!;
  return { month, year, name };
}

/** Wipes every collection. Used by `pnpm seed --reset` and by tests. */
export async function clear(): Promise<void> {
  await Promise.all([
    Tenant.deleteMany({}),
    Company.deleteMany({}),
    Location.deleteMany({}),
    Department.deleteMany({}),
    User.deleteMany({}),
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
}
