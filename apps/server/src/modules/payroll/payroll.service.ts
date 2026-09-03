import { Types } from 'mongoose';
import {
  ApprovalStatus,
  NotificationType,
  PayrollBatchStatus,
  ValidationSeverity,
  formatINR,
  payrollBatchMachine,
} from '@fpc/shared';
import { ApiError } from '../../core/errors.js';
import { eventBus } from '../../core/eventBus.js';
import { storage } from '../../integrations/storage/index.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { Location } from '../../models/location.model.js';
import { Department } from '../../models/department.model.js';
import { PayrollBatch, PayrollEmployee } from '../../models/payroll.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { createObligationsForPayroll } from '../payments/obligation.service.js';
import { parsePayrollFile, type PayrollField, type PayrollImportResult } from './payroll.import.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface ImportInput {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  periodMonth: number;
  periodYear: number;
  label?: string;
  fileName: string;
  content: Buffer;
  contentType: string;
  mapping?: Partial<Record<PayrollField, string>>;
  importedBy: Types.ObjectId;
}

/**
 * Previews an uploaded payroll file without writing anything.
 *
 * The import screen shows the detected column mapping and the validation
 * summary first, so a mis-detected column is caught before 850 payment
 * instructions exist.
 */
export async function preview(
  content: Buffer,
  fileName: string,
  mapping?: Partial<Record<PayrollField, string>>,
): Promise<PayrollImportResult> {
  return parsePayrollFile(content, fileName, mapping);
}

/** Commits a parsed payroll file into a batch and its employee rows. */
export async function importBatch(input: ImportInput, context: AuditContext) {
  const parsed = await parsePayrollFile(input.content, input.fileName, input.mapping);

  if (!parsed.rows.length) {
    throw ApiError.unprocessable(
      'No payable employee rows were found in this file',
      parsed.findings.length ? parsed.findings : parsed.rejected,
    );
  }

  const existing = await PayrollBatch.findOne({
    tenantId: input.tenantId,
    companyId: input.companyId,
    periodMonth: input.periodMonth,
    periodYear: input.periodYear,
  }).lean();

  if (existing && existing.status !== PayrollBatchStatus.CANCELLED) {
    throw ApiError.conflict(
      `A payroll batch already exists for ${MONTHS[input.periodMonth - 1]} ${input.periodYear} (${existing.status}). ` +
        'Cancel it before importing a replacement.',
    );
  }

  const stored = await storage().put({
    key: `payroll/${String(input.companyId)}/${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}-${Date.now()}-${input.fileName}`,
    body: input.content,
    contentType: input.contentType,
  });
  const file = await DocumentFile.create({
    tenantId: input.tenantId,
    companyId: input.companyId,
    key: stored.key,
    fileName: input.fileName,
    contentType: stored.contentType,
    size: stored.size,
    checksum: stored.checksum,
    driver: storage().name,
    uploadedBy: input.importedBy,
    kind: 'PAYROLL_IMPORT',
  });

  // Resolve free-text location and department names to real records where
  // they match, so the CFO's location filters work on the payroll too.
  const [locations, departments] = await Promise.all([
    Location.find({ tenantId: input.tenantId, companyId: input.companyId }).select('name code').lean(),
    Department.find({ tenantId: input.tenantId, companyId: input.companyId }).select('name code').lean(),
  ]);
  const locationByName = byNameOrCode(locations);
  const departmentByName = byNameOrCode(departments);

  const label =
    input.label ?? `${MONTHS[input.periodMonth - 1]} ${input.periodYear} Payroll`;
  const previous = await PayrollBatch.findOne({
    tenantId: input.tenantId,
    companyId: input.companyId,
    status: { $nin: [PayrollBatchStatus.CANCELLED, PayrollBatchStatus.REJECTED] },
    $or: [
      { periodYear: { $lt: input.periodYear } },
      { periodYear: input.periodYear, periodMonth: { $lt: input.periodMonth } },
    ],
  })
    .sort({ periodYear: -1, periodMonth: -1 })
    .lean();

  const hasErrors = parsed.rows.some((row) =>
    row.findings.some((finding) => finding.severity === ValidationSeverity.ERROR),
  );

  const batch = await PayrollBatch.create({
    tenantId: input.tenantId,
    companyId: input.companyId,
    reference: `PR-${input.periodYear}${String(input.periodMonth).padStart(2, '0')}`,
    periodMonth: input.periodMonth,
    periodYear: input.periodYear,
    label,
    status: hasErrors ? PayrollBatchStatus.REVIEW_REQUIRED : PayrollBatchStatus.VALIDATED,
    employeeCount: parsed.employeeCount,
    totalNetAmount: parsed.totalNetAmount,
    locationBreakdown: parsed.locationBreakdown.map((entry) => ({
      locationId: locationByName.get(canonical(entry.locationName)),
      locationName: entry.locationName,
      count: entry.count,
      amount: entry.amount,
    })),
    previousBatchId: previous?._id,
    previousTotalNetAmount: previous?.totalNetAmount,
    sourceFileId: file._id,
    sourceFileName: input.fileName,
    findings: parsed.findings,
    approvalStatus: ApprovalStatus.PENDING,
    importedBy: input.importedBy,
  });

  await PayrollEmployee.insertMany(
    parsed.rows.map((row) => ({
      tenantId: input.tenantId,
      companyId: input.companyId,
      payrollBatchId: batch._id,
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      bankAccountNumber: row.bankAccountNumber,
      ifsc: row.ifsc,
      netAmount: row.netAmount,
      departmentName: row.departmentName,
      departmentId: row.departmentName ? departmentByName.get(canonical(row.departmentName)) : undefined,
      locationName: row.locationName,
      locationId: row.locationName ? locationByName.get(canonical(row.locationName)) : undefined,
      email: row.email,
      rowNumber: row.rowNumber,
      findings: row.findings,
    })),
  );

  await audit.record(
    {
      event: 'payroll.imported',
      entityType: 'PAYROLL_BATCH',
      entityId: batch._id,
      entityLabel: label,
      tenantId: input.tenantId,
      companyId: input.companyId,
      // Deliberately aggregate only — the audit trail must not become a
      // second copy of everyone's salary.
      metadata: {
        fileName: input.fileName,
        employeeCount: parsed.employeeCount,
        totalNetAmount: parsed.totalNetAmount,
        rejectedRows: parsed.rejected.length,
        checksum: stored.checksum,
      },
    },
    context,
  );

  return { batch, parsed };
}

/** Submits a payroll batch into the approval chain — PRD §19. */
export async function submitForApproval(
  batchId: Types.ObjectId,
  submittedBy: Types.ObjectId,
  context: AuditContext,
) {
  const batch = await PayrollBatch.findById(batchId);
  if (!batch) throw ApiError.notFound('Payroll batch');

  const blocking = await PayrollEmployee.countDocuments({
    payrollBatchId: batch._id,
    'findings.severity': ValidationSeverity.ERROR,
  });
  if (blocking > 0) {
    throw ApiError.unprocessable(
      `${blocking} employee ${blocking === 1 ? 'row has' : 'rows have'} errors. Fix the payroll file and re-import before submitting.`,
    );
  }

  payrollBatchMachine.assertTransition(batch.status, PayrollBatchStatus.PENDING_APPROVAL);

  const { startApproval } = await import('../approvals/approval.service.js');
  const outcome = await startApproval(
    {
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      subjectType: 'PAYROLL_BATCH',
      subjectId: batch._id,
      subjectLabel: batch.label,
      amount: batch.totalNetAmount,
      requestedByUserId: submittedBy,
      employeeCount: batch.employeeCount,
      link: `/payroll/${String(batch._id)}`,
    },
    context,
  );

  batch.submittedBy = submittedBy;
  batch.submittedAt = new Date();

  if (outcome.request) {
    batch.status = PayrollBatchStatus.PENDING_APPROVAL;
    batch.approvalRequestId = outcome.request._id;
    batch.approvalStatus = ApprovalStatus.IN_PROGRESS;
    await batch.save();
  } else {
    batch.status = PayrollBatchStatus.APPROVED;
    batch.approvalStatus = ApprovalStatus.APPROVED;
    await batch.save();
    await onApproved(batch._id, context);
  }

  await audit.record(
    {
      event: 'payroll.submitted',
      entityType: 'PAYROLL_BATCH',
      entityId: batch._id,
      entityLabel: batch.label,
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      metadata: {
        employeeCount: batch.employeeCount,
        totalNetAmount: batch.totalNetAmount,
        approvalRequestId: outcome.request ? String(outcome.request._id) : null,
      },
    },
    context,
  );

  return { batch, approvalRequestId: outcome.request?._id ?? null };
}

/**
 * Fans an approved payroll batch out into per-employee obligations, which is
 * where payroll joins the common payment pipeline (PRD §20).
 */
export async function onApproved(batchId: Types.ObjectId, context: AuditContext): Promise<void> {
  const batch = await PayrollBatch.findById(batchId);
  if (!batch) return;

  if (batch.status !== PayrollBatchStatus.APPROVED) {
    payrollBatchMachine.assertTransition(batch.status, PayrollBatchStatus.APPROVED);
    batch.status = PayrollBatchStatus.APPROVED;
    batch.approvalStatus = ApprovalStatus.APPROVED;
    await batch.save();
  }

  const employees = await PayrollEmployee.find({ payrollBatchId: batch._id }).lean();
  const { created, skipped } = await createObligationsForPayroll(
    {
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      batchId: batch._id,
      batchReference: batch.reference,
      rows: employees.map((employee) => ({
        employeeId: employee._id,
        employeeCode: employee.employeeCode,
        employeeName: employee.employeeName,
        bankAccountNumber: employee.bankAccountNumber,
        ifsc: employee.ifsc,
        amount: employee.netAmount,
        locationId: employee.locationId,
        departmentId: employee.departmentId,
      })),
    },
    context,
  );

  payrollBatchMachine.assertTransition(batch.status, PayrollBatchStatus.PAYMENT_PENDING);
  batch.status = PayrollBatchStatus.PAYMENT_PENDING;
  await batch.save();

  eventBus.publish({
    type: NotificationType.PAYROLL_APPROVED,
    tenantId: String(batch.tenantId),
    companyId: String(batch.companyId),
    entityType: 'PAYROLL_BATCH',
    entityId: String(batch._id),
    recipientUserIds: [batch.importedBy, batch.submittedBy].filter(Boolean).map(String),
    title: `${batch.label} approved`,
    body: `${batch.employeeCount} employees totalling ${formatINR(batch.totalNetAmount)} are now in the payment queue.`,
    link: `/payroll/${String(batch._id)}`,
    metadata: { obligationsCreated: created, obligationsSkipped: skipped },
  });
}

/** Applies a rejection from the approval chain. */
export async function onRejected(batchId: Types.ObjectId, context: AuditContext): Promise<void> {
  const batch = await PayrollBatch.findById(batchId);
  if (!batch) return;

  const from = batch.status;
  batch.status = PayrollBatchStatus.REJECTED;
  batch.approvalStatus = ApprovalStatus.REJECTED;
  await batch.save();

  await audit.recordStatusChange(
    {
      event: 'payroll.rejected',
      entityType: 'PAYROLL_BATCH',
      entityId: batch._id,
      entityLabel: batch.label,
      tenantId: batch.tenantId,
      companyId: batch.companyId,
      from,
      to: PayrollBatchStatus.REJECTED,
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.PAYROLL_REJECTED,
    tenantId: String(batch.tenantId),
    companyId: String(batch.companyId),
    entityType: 'PAYROLL_BATCH',
    entityId: String(batch._id),
    recipientUserIds: [batch.importedBy, batch.submittedBy].filter(Boolean).map(String),
    title: `${batch.label} was rejected`,
    body: `${batch.label} for ${formatINR(batch.totalNetAmount)} was rejected during approval.`,
    link: `/payroll/${String(batch._id)}`,
  });
}

function byNameOrCode(
  records: Array<{ _id: Types.ObjectId; name: string; code?: string }>,
): Map<string, Types.ObjectId> {
  const map = new Map<string, Types.ObjectId>();
  for (const record of records) {
    map.set(canonical(record.name), record._id);
    if (record.code) map.set(canonical(record.code), record._id);
  }
  return map;
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
