import { Router } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { PayrollBatchStatus, ValidationSeverity, schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { resolveWriteCompany, scopeFilter } from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { PayrollBatch, PayrollEmployee } from '../../models/payroll.model.js';
import { audit, auditContext } from '../audit/audit.service.js';
import { maskAccount } from '../payments/obligation.service.js';
import * as payrollService from './payroll.service.js';
import { escapeRegex } from '../organization/crudFactory.js';

const ACCEPTED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ACCEPTED.has(file.mimetype) && !/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      callback(ApiError.badRequest('Upload payroll as .xlsx or .csv'));
      return;
    }
    callback(null, true);
  },
});

/**
 * Payroll — PRD §17–§19.
 *
 * Every route here requires a `payroll:*` permission, which ordinary AP roles
 * do not hold: salary data is not visible to the rest of the finance team.
 */
export const payrollRouter: Router = Router();

payrollRouter.get(
  '/',
  requirePermission('payroll:read'),
  validateQuery(schemas.payrollListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.payrollListQuery>(req);
    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    if (q.status) filter.status = q.status;
    if (q.periodYear) filter.periodYear = q.periodYear;

    res.json(
      await paginate(
        PayrollBatch,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          defaultSort: { periodYear: -1, periodMonth: -1 },
        },
        toApi,
      ),
    );
  }),
);

/**
 * Batch detail — the CFO's approval view (PRD §19): totals, location split,
 * and the month-on-month delta, without listing individual salaries.
 */
payrollRouter.get(
  '/:id',
  requirePermission('payroll:read'),
  asyncHandler(async (req, res) => {
    const batch = await findScoped(req);
    const difference =
      batch.previousTotalNetAmount !== undefined
        ? batch.totalNetAmount - batch.previousTotalNetAmount
        : null;

    res.json({
      ...toApi(batch),
      comparison: {
        previousTotalNetAmount: batch.previousTotalNetAmount ?? null,
        difference,
        percentChange: batch.previousTotalNetAmount
          ? Number(((difference! / batch.previousTotalNetAmount) * 100).toFixed(2))
          : null,
      },
    });
  }),
);

/** The per-employee register. Separately paginated — a batch can be thousands of rows. */
payrollRouter.get(
  '/:id/employees',
  requirePermission('payroll:read'),
  validateQuery(schemas.payrollEmployeeListQuery),
  asyncHandler(async (req, res) => {
    const batch = await findScoped(req);
    const q = query<typeof schemas.payrollEmployeeListQuery>(req);

    const filter: Record<string, unknown> = { payrollBatchId: batch._id };
    if (q.locationId) filter.locationId = new Types.ObjectId(q.locationId);
    if (q.onlyWithFindings) filter['findings.0'] = { $exists: true };
    if (q.q) {
      const pattern = { $regex: escapeRegex(q.q), $options: 'i' };
      filter.$or = [{ employeeName: pattern }, { employeeCode: pattern }];
    }

    res.json(
      await paginate(
        PayrollEmployee,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          defaultSort: { rowNumber: 1 },
        },
        (doc) => {
          const api = toApi(doc);
          return api
            ? { ...api, bankAccountNumber: maskAccount(String(api.bankAccountNumber ?? '')) }
            : null;
        },
      ),
    );
  }),
);

/**
 * Dry-run an upload: returns the detected column mapping and validation
 * summary without creating anything, so a mis-detected column is caught
 * before payment instructions exist.
 */
payrollRouter.post(
  '/preview',
  requirePermission('payroll:create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('A payroll file is required');
    const mapping = parseMapping(req.body);

    const result = await payrollService.preview(req.file.buffer, req.file.originalname, mapping);

    res.json({
      headers: result.headers,
      mapping: result.mapping,
      employeeCount: result.employeeCount,
      totalNetAmount: result.totalNetAmount,
      locationBreakdown: result.locationBreakdown,
      findings: result.findings,
      rejected: result.rejected.slice(0, 50),
      // A sample rather than the whole file: enough to confirm the mapping
      // is right without shipping every salary to the browser.
      sample: result.rows.slice(0, 10).map((row) => ({
        rowNumber: row.rowNumber,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        bankAccountNumber: maskAccount(row.bankAccountNumber),
        ifsc: row.ifsc,
        netAmount: row.netAmount,
        departmentName: row.departmentName,
        locationName: row.locationName,
        findings: row.findings,
      })),
      rowsWithErrors: result.rows.filter((row) =>
        row.findings.some((finding) => finding.severity === ValidationSeverity.ERROR),
      ).length,
    });
  }),
);

/** Commits the import — PRD §36 `/payroll/import`. */
payrollRouter.post(
  '/import',
  requirePermission('payroll:create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    if (!req.file) throw ApiError.badRequest('A payroll file is required');

    const body = req.body as Record<string, string>;
    const parsedBody = schemas.createPayrollBatchRequest.omit({ mapping: true }).safeParse({
      companyId: body.companyId,
      label: body.label || 'Payroll',
      periodMonth: body.periodMonth,
      periodYear: body.periodYear,
    });
    if (!parsedBody.success) {
      throw ApiError.unprocessable('Payroll period is invalid', parsedBody.error.issues);
    }

    const { batch, parsed } = await payrollService.importBatch(
      {
        tenantId: principal.tenantId,
        companyId: resolveWriteCompany(principal, parsedBody.data.companyId),
        periodMonth: parsedBody.data.periodMonth,
        periodYear: parsedBody.data.periodYear,
        label: body.label || undefined,
        fileName: req.file.originalname,
        content: req.file.buffer,
        contentType: req.file.mimetype,
        mapping: parseMapping(req.body),
        importedBy: principal.userId,
      },
      auditContext(req),
    );

    res.status(201).json({
      batch: toApi(batch.toObject()),
      employeeCount: parsed.employeeCount,
      totalNetAmount: parsed.totalNetAmount,
      rejected: parsed.rejected.slice(0, 50),
      findings: parsed.findings,
    });
  }),
);

payrollRouter.post(
  '/:id/submit',
  requirePermission('payroll:submit'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const batch = await findScoped(req);

    const result = await payrollService.submitForApproval(
      batch._id,
      principal.userId,
      auditContext(req),
    );

    res.json({
      batch: toApi(result.batch.toObject()),
      approvalRequestId: result.approvalRequestId ? String(result.approvalRequestId) : null,
    });
  }),
);

payrollRouter.delete(
  '/:id',
  requirePermission('payroll:delete'),
  asyncHandler(async (req, res) => {
    const batch = await findScoped(req);
    const doc = await PayrollBatch.findById(batch._id);
    if (!doc) throw ApiError.notFound('Payroll batch');

    // Once obligations exist the money is in flight; cancelling here would
    // leave orphaned payment instructions.
    const cancellable: string[] = [
      PayrollBatchStatus.DRAFT,
      PayrollBatchStatus.IMPORTED,
      PayrollBatchStatus.REVIEW_REQUIRED,
      PayrollBatchStatus.VALIDATED,
      PayrollBatchStatus.PENDING_APPROVAL,
      PayrollBatchStatus.REJECTED,
    ];
    if (!cancellable.includes(doc.status)) {
      throw ApiError.conflict(`A payroll batch in ${doc.status} can no longer be cancelled`);
    }

    const from = doc.status;
    doc.status = PayrollBatchStatus.CANCELLED;
    await doc.save();

    const { cancel } = await import('../approvals/approval.service.js');
    await cancel(doc._id, 'Payroll batch cancelled', auditContext(req));

    await audit.recordStatusChange(
      {
        event: 'payroll.cancelled',
        entityType: 'PAYROLL_BATCH',
        entityId: doc._id,
        entityLabel: doc.label,
        tenantId: doc.tenantId,
        companyId: doc.companyId,
        from,
        to: PayrollBatchStatus.CANCELLED,
      },
      auditContext(req),
    );

    res.status(204).send();
  }),
);

function parseMapping(body: unknown): Record<string, string> | undefined {
  const raw = (body as { mapping?: string })?.mapping;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length ? parsed : undefined;
  } catch {
    throw ApiError.badRequest('mapping must be a JSON object of field → column heading');
  }
}

async function findScoped(req: Parameters<typeof requirePrincipal>[0]) {
  const principal = requirePrincipal(req);
  const id = req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid payroll batch id');

  const batch = await PayrollBatch.findOne({
    _id: new Types.ObjectId(id),
    ...scopeFilter(principal),
  }).lean();
  if (!batch) throw ApiError.notFound('Payroll batch');
  return batch;
}
