import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ObligationType,
  PAYROLL_VISIBILITY_PERMISSION,
  PaymentStatus,
  schemas,
} from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { applyLocationScope, resolveWriteCompany, scopeFilter } from '../../middleware/tenantScope.js';
import { storage } from '../../integrations/storage/index.js';
import { toApi } from '../../models/base.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { PaymentBatch, PaymentBatchItem } from '../../models/paymentBatch.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { audit, auditContext } from '../audit/audit.service.js';
import * as batchService from './paymentBatch.service.js';
import { maskAccount } from './obligation.service.js';

export const paymentRouter: Router = Router();

/**
 * The payment queue — PRD §21, one of the primary operational screens.
 *
 * Payroll confidentiality (PRD §18/§21): a caller without `payroll:read` does
 * not receive per-employee rows. They see one aggregated line per payroll
 * batch, which is exactly what the PRD's queue mock-up shows, so they can
 * still assemble a payment batch without ever seeing individual salaries.
 */
paymentRouter.get(
  '/queue',
  requirePermission('obligation:read'),
  validateQuery(schemas.paymentQueueQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.paymentQueueQuery>(req);
    const canSeePayroll = principal.permissions.includes(PAYROLL_VISIBILITY_PERMISSION);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    applyLocationScope(principal, filter, q.locationId);
    filter.approvalStatus = 'APPROVED';
    filter.paymentStatus = q.paymentStatus ?? {
      $in: [PaymentStatus.QUEUED, PaymentStatus.PENDING],
    };
    if (q.type) filter.type = q.type;
    if (q.dueBefore) filter.dueDate = { $lte: new Date(q.dueBefore) };
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      filter.amount = {
        ...(q.minAmount !== undefined ? { $gte: q.minAmount } : {}),
        ...(q.maxAmount !== undefined ? { $lte: q.maxAmount } : {}),
      };
    }

    if (canSeePayroll) {
      res.json(
        await paginate(PaymentObligation, filter, {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          defaultSort: { dueDate: 1 },
        }, presentObligation),
      );
      return;
    }

    const vendorPage = await paginate(
      PaymentObligation,
      { ...filter, type: ObligationType.VENDOR },
      {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
        order: q.order,
        defaultSort: { dueDate: 1 },
      },
      presentObligation,
    );

    // Only the first page carries the payroll summary rows, so they are not
    // repeated on every page of vendor results.
    const payrollRows = q.page === 1 && q.type !== 'VENDOR' ? await payrollSummaryRows(filter) : [];

    res.json({
      ...vendorPage,
      items: [...payrollRows, ...vendorPage.items],
      payrollAggregated: true,
    });
  }),
);

/** Puts an obligation on hold, or releases it, without leaving the queue. */
paymentRouter.post(
  '/queue/:id/hold',
  requirePermission('obligation:update'),
  validateBody(schemas.holdObligationRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const { hold, reason } = req.body as { hold: boolean; reason?: string };

    const obligation = await PaymentObligation.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    });
    if (!obligation) throw ApiError.notFound('Payment');
    if (obligation.paymentStatus === PaymentStatus.PAID) {
      throw ApiError.conflict('This payment has already been made');
    }
    if (obligation.paymentBatchId) {
      throw ApiError.conflict('Remove this payment from its batch before putting it on hold');
    }

    obligation.paymentStatus = hold ? PaymentStatus.ON_HOLD : PaymentStatus.QUEUED;
    obligation.holdReason = hold ? reason : undefined;
    await obligation.save();

    await audit.record(
      {
        event: hold ? 'obligation.held' : 'obligation.released',
        entityType: 'PAYMENT_OBLIGATION',
        entityId: obligation._id,
        entityLabel: `${obligation.payeeName} ${obligation.reference}`,
        tenantId: obligation.tenantId,
        companyId: obligation.companyId,
        metadata: { reason },
      },
      auditContext(req),
    );

    res.json(presentObligation(obligation.toObject()));
  }),
);

/** Payment batches — PRD §36 `/payments/batches`. */
paymentRouter.get(
  '/batches',
  requirePermission('payment_batch:read'),
  validateQuery(schemas.paymentBatchListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.paymentBatchListQuery>(req);
    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    if (q.status) filter.status = q.status;

    res.json(
      await paginate(PaymentBatch, filter, {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
        order: q.order,
        defaultSort: { paymentDate: -1 },
      }, toApi),
    );
  }),
);

paymentRouter.get(
  '/batches/:id',
  requirePermission('payment_batch:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const canSeePayroll = principal.permissions.includes(PAYROLL_VISIBILITY_PERMISSION);

    const batch = await PaymentBatch.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    }).lean();
    if (!batch) throw ApiError.notFound('Payment batch');

    const itemFilter: Record<string, unknown> = { paymentBatchId: batch._id };
    if (!canSeePayroll) itemFilter.type = ObligationType.VENDOR;

    const items = await PaymentBatchItem.find(itemFilter).sort({ amount: -1 }).limit(2000).lean();

    res.json({
      ...toApi(batch),
      items: items.map((item) => ({
        ...toApi(item),
        beneficiaryAccount: maskAccount(item.beneficiaryAccount),
      })),
      // Be explicit that rows are missing rather than letting the totals and
      // the visible list silently disagree.
      payrollItemsHidden: !canSeePayroll && batch.payrollCount > 0 ? batch.payrollCount : 0,
    });
  }),
);

paymentRouter.post(
  '/batches',
  requirePermission('payment_batch:create'),
  validateBody(schemas.createPaymentBatchRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as schemas.CreatePaymentBatchRequest;
    const companyId = resolveWriteCompany(principal, payload.companyId);

    // Batching payroll means handling salary data, even if the rows are never
    // rendered — so require the payroll permission for it.
    const selected = await PaymentObligation.find({
      _id: { $in: payload.obligationIds.map((id) => new Types.ObjectId(id)) },
      tenantId: principal.tenantId,
    })
      .select('type')
      .lean();
    const includesPayroll = selected.some((entry) => entry.type === ObligationType.PAYROLL);
    if (includesPayroll && !principal.permissions.includes(PAYROLL_VISIBILITY_PERMISSION)) {
      throw ApiError.forbidden('Batching payroll payments requires payroll:read');
    }

    const batch = await batchService.createBatch(
      {
        tenantId: principal.tenantId,
        companyId,
        paymentDate: new Date(payload.paymentDate),
        bankAccountId: payload.bankAccountId ? new Types.ObjectId(payload.bankAccountId) : undefined,
        bankFileFormat: payload.bankFileFormat,
        obligationIds: payload.obligationIds.map((id) => new Types.ObjectId(id)),
        notes: payload.notes,
        createdBy: principal.userId,
      },
      auditContext(req),
    );

    res.status(201).json(toApi(batch.toObject()));
  }),
);

paymentRouter.patch(
  '/batches/:id',
  requirePermission('payment_batch:update'),
  validateBody(schemas.updatePaymentBatchRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as Record<string, unknown>;
    const batchId = objectId(req.params.id);

    const batch = await PaymentBatch.findOne({ _id: batchId, ...scopeFilter(principal) });
    if (!batch) throw ApiError.notFound('Payment batch');

    if (Array.isArray(payload.removeObligationIds) && payload.removeObligationIds.length) {
      await batchService.removeFromBatch(
        batchId,
        (payload.removeObligationIds as string[]).map((id) => new Types.ObjectId(id)),
        auditContext(req),
      );
    }
    if (payload.paymentDate) batch.paymentDate = new Date(String(payload.paymentDate));
    if (payload.bankFileFormat) batch.bankFileFormat = payload.bankFileFormat as never;
    if (payload.notes !== undefined) batch.notes = String(payload.notes);
    await batch.save();

    res.json(toApi((await PaymentBatch.findById(batchId).lean())!));
  }),
);

/** Generates the bank file — PRD §23. */
paymentRouter.post(
  '/batches/:id/export',
  requirePermission('payment_batch:export'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const batchId = objectId(req.params.id);

    const batch = await PaymentBatch.findOne({ _id: batchId, ...scopeFilter(principal) }).lean();
    if (!batch) throw ApiError.notFound('Payment batch');

    const result = await batchService.exportBatch(
      batchId,
      {
        userId: principal.userId,
        name: principal.name,
        // A company admin can break the tie in a small finance team where the
        // same person prepares and releases payments.
        canOverrideMakerChecker: principal.roleKeys.includes('COMPANY_ADMIN'),
      },
      auditContext(req),
    );

    res.json({
      batch: toApi(result.batch.toObject()),
      file: { id: String(result.document._id), fileName: result.file.fileName },
      downloadUrl: `/api/payments/batches/${String(batchId)}/file`,
    });
  }),
);

/** Streams the generated bank file. */
paymentRouter.get(
  '/batches/:id/file',
  requirePermission('payment_batch:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const batch = await PaymentBatch.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    }).lean();
    if (!batch?.exportFileId) throw ApiError.notFound('Bank file');

    const file = await DocumentFile.findById(batch.exportFileId).lean();
    if (!file) throw ApiError.notFound('Bank file');

    await audit.record(
      {
        event: 'payment_batch.file_downloaded',
        entityType: 'PAYMENT_BATCH',
        entityId: batch._id,
        entityLabel: batch.reference,
        tenantId: batch.tenantId,
        companyId: batch.companyId,
        metadata: { fileName: file.fileName },
      },
      auditContext(req),
    );

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    (await storage().stream(file.key)).pipe(res);
  }),
);

/** Aggregated payroll rows for callers who may not see individual salaries. */
async function payrollSummaryRows(filter: Record<string, unknown>): Promise<unknown[]> {
  const grouped = await PaymentObligation.aggregate<{
    _id: Types.ObjectId | null;
    amount: number;
    count: number;
    dueDate: Date | null;
    reference: string;
  }>([
    { $match: { ...filter, type: ObligationType.PAYROLL } },
    {
      $group: {
        _id: '$sourceBatchId',
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
        dueDate: { $min: '$dueDate' },
        reference: { $first: '$paymentBatchReference' },
      },
    },
    { $sort: { dueDate: 1 } },
  ]);

  return grouped.map((group) => ({
    id: `payroll-batch:${String(group._id)}`,
    type: ObligationType.PAYROLL,
    aggregate: true,
    sourceBatchId: String(group._id),
    payeeName: 'Payroll',
    reference: group.reference ?? 'Payroll batch',
    amount: group.amount,
    employeeCount: group.count,
    dueDate: group.dueDate,
    paymentStatus: 'QUEUED',
    // No beneficiary details: this row stands for many employees.
    beneficiaryName: `${group.count} employees`,
    beneficiaryAccount: null,
    ifsc: null,
  }));
}

function presentObligation(doc: unknown): Record<string, unknown> | null {
  const api = toApi(doc);
  if (!api) return null;
  return {
    ...api,
    beneficiaryAccount: maskAccount(String(api.beneficiaryAccount ?? '')),
  };
}

function objectId(value: string | undefined): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid id');
  return new Types.ObjectId(value);
}
