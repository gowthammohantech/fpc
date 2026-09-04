import { Router } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import {
  InvoiceStatus,
  SUPPORTED_INVOICE_CONTENT_TYPES,
  ValidationCode,
  ValidationSeverity,
  schemas,
} from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import {
  applyLocationScope,
  resolveWriteCompany,
  scopeFilter,
} from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { Invoice } from '../../models/invoice.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { storage } from '../../integrations/storage/index.js';
import { audit, auditContext } from '../audit/audit.service.js';
import * as invoiceService from './invoice.service.js';
import { escapeRegex } from '../organization/crudFactory.js';

const ACCEPTED_TYPES = new Set<string>(SUPPORTED_INVOICE_CONTENT_TYPES);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ACCEPTED_TYPES.has(file.mimetype)) {
      callback(ApiError.badRequest('Only PDF, JPG and PNG invoices are supported'));
      return;
    }
    callback(null, true);
  },
});

export const invoiceRouter: Router = Router();

/** Register and review queue — PRD §36 `/invoices`, `/invoices/review`. */
invoiceRouter.get(
  '/',
  requirePermission('invoice:read'),
  validateQuery(schemas.invoiceListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.invoiceListQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    applyLocationScope(principal, filter, q.locationId);

    if (q.vendorId) filter.vendorId = new Types.ObjectId(q.vendorId);
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    if (q.status) filter.status = Array.isArray(q.status) ? { $in: q.status } : q.status;
    Object.assign(filter, viewFilter(q.view));

    if (q.dateFrom || q.dateTo) {
      filter.invoiceDate = {
        ...(q.dateFrom ? { $gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { $lte: new Date(q.dateTo) } : {}),
      };
    }
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      filter.totalAmount = {
        ...(q.minAmount !== undefined ? { $gte: q.minAmount } : {}),
        ...(q.maxAmount !== undefined ? { $lte: q.maxAmount } : {}),
      };
    }
    if (q.q) {
      const pattern = { $regex: escapeRegex(q.q), $options: 'i' };
      filter.$or = [
        { invoiceNumber: pattern },
        { vendorName: pattern },
        { documentFileName: pattern },
      ];
    }

    res.json(
      await paginate(
        Invoice,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          defaultSort: { receivedAt: -1 },
        },
        toApi,
      ),
    );
  }),
);

invoiceRouter.get(
  '/:id',
  requirePermission('invoice:read'),
  asyncHandler(async (req, res) => {
    res.json(toApi(await findScoped(req)));
  }),
);

/** Streams the original document for the side-by-side review screen. */
invoiceRouter.get(
  '/:id/document',
  requirePermission('invoice:read'),
  asyncHandler(async (req, res) => {
    const invoice = await findScoped(req);
    const file = invoice.documentFileId
      ? await DocumentFile.findById(invoice.documentFileId).lean()
      : null;
    if (!file) throw ApiError.notFound('Invoice document');

    // Prefer a direct link when the driver can issue one; otherwise proxy.
    const direct = await storage().signedUrl(file.key);
    if (direct) {
      res.json({ url: direct, fileName: file.fileName, contentType: file.contentType });
      return;
    }

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    (await storage().stream(file.key)).pipe(res);
  }),
);

/** Manual intake — PRD §11. */
invoiceRouter.post(
  '/upload',
  requirePermission('invoice:create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    if (!req.file) throw ApiError.badRequest('A file is required');

    const companyId = resolveWriteCompany(
      principal,
      (req.body as { companyId?: string }).companyId,
    );
    const invoice = await invoiceService.intake(
      {
        tenantId: principal.tenantId,
        companyId,
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        content: req.file.buffer,
        source: 'UPLOAD',
        uploadedBy: principal.userId,
      },
      auditContext(req),
    );

    // Extraction is queued rather than awaited: upload should return as soon
    // as the document is safely stored.
    void invoiceService.runExtraction(invoice._id);

    res.status(201).json(toApi(invoice));
  }),
);

/** Reviewer corrections — PRD §12 ("finance can edit extracted values"). */
invoiceRouter.patch(
  '/:id',
  requirePermission('invoice:update'),
  validateBody(schemas.updateInvoiceRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const invoice = await findScopedDoc(req);

    const editableStatuses: string[] = [
      InvoiceStatus.REVIEW_REQUIRED,
      InvoiceStatus.VALIDATED,
      InvoiceStatus.FAILED,
      InvoiceStatus.REJECTED,
    ];
    if (!editableStatuses.includes(invoice.status)) {
      throw ApiError.conflict(`An invoice in ${invoice.status} can no longer be edited`);
    }

    const payload = req.body as schemas.UpdateInvoiceRequest;
    const before = {
      vendorId: invoice.vendorId ? String(invoice.vendorId) : undefined,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      totalAmount: invoice.totalAmount,
    };

    if (payload.vendorId) {
      const vendor = await Vendor.findOne({
        _id: new Types.ObjectId(payload.vendorId),
        tenantId: principal.tenantId,
        companyId: invoice.companyId,
      }).lean();
      if (!vendor) throw ApiError.badRequest('Unknown vendor for this company');
      invoice.vendorId = vendor._id;
      invoice.vendorName = vendor.name;
    }

    if (payload.invoiceNumber !== undefined) invoice.invoiceNumber = payload.invoiceNumber;
    if (payload.invoiceDate) invoice.invoiceDate = new Date(payload.invoiceDate);
    if (payload.dueDate) invoice.dueDate = new Date(payload.dueDate);
    if (payload.gstin !== undefined) invoice.gstin = payload.gstin;
    if (payload.subtotal !== undefined) invoice.subtotal = payload.subtotal;
    if (payload.taxAmount !== undefined) invoice.taxAmount = payload.taxAmount;
    if (payload.totalAmount !== undefined) invoice.totalAmount = payload.totalAmount;
    if (payload.locationId !== undefined) {
      invoice.locationId = payload.locationId ? new Types.ObjectId(payload.locationId) : undefined;
    }
    if (payload.departmentId !== undefined) {
      invoice.departmentId = payload.departmentId
        ? new Types.ObjectId(payload.departmentId)
        : undefined;
    }
    if (payload.lines) invoice.lines = payload.lines;

    // Mark edited fields so the review screen stops flagging them as
    // low-confidence machine output.
    if (invoice.extraction?.fields) {
      for (const key of Object.keys(payload)) {
        const field = invoice.extraction.fields[key];
        if (field) field.edited = true;
      }
      invoice.markModified('extraction');
    }

    invoice.findings = await invoiceService.revalidate(invoice);
    if (invoice.status === InvoiceStatus.FAILED) {
      await invoiceService.transition(invoice, InvoiceStatus.REVIEW_REQUIRED);
    }
    await invoice.save();

    await audit.record(
      {
        event: 'invoice.updated',
        entityType: 'INVOICE',
        entityId: invoice._id,
        entityLabel: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        oldValue: before,
        newValue: payload,
      },
      auditContext(req),
    );

    res.json(toApi(invoice.toObject()));
  }),
);

/** Records a decision on a duplicate warning — PRD §13. */
invoiceRouter.post(
  '/:id/findings/resolve',
  requirePermission('invoice:resolve_duplicate'),
  validateBody(schemas.resolveFindingRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const invoice = await findScopedDoc(req);
    const { code, resolution, note } = req.body as schemas.ResolveFindingRequest;

    const finding = invoice.findings.find((entry) => entry.code === code && !entry.resolved);
    if (!finding) throw ApiError.notFound('Unresolved finding');

    finding.resolved = true;
    finding.resolvedBy = String(principal.userId);
    finding.resolvedAt = new Date().toISOString();
    finding.resolutionNote = note;
    invoice.markModified('findings');

    if (resolution === 'DUPLICATE') {
      await invoiceService.transition(invoice, InvoiceStatus.DUPLICATE);
    }
    await invoice.save();

    await audit.record(
      {
        event: resolution === 'DUPLICATE' ? 'invoice.marked_duplicate' : 'invoice.finding_resolved',
        entityType: 'INVOICE',
        entityId: invoice._id,
        entityLabel: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        metadata: { code, resolution, note },
      },
      auditContext(req),
    );

    res.json(toApi(invoice.toObject()));
  }),
);

/** Re-runs extraction, e.g. after configuring a real OCR driver. */
invoiceRouter.post(
  '/:id/reextract',
  requirePermission('invoice:update'),
  asyncHandler(async (req, res) => {
    const invoice = await findScopedDoc(req);
    if (
      invoice.status !== InvoiceStatus.REVIEW_REQUIRED &&
      invoice.status !== InvoiceStatus.FAILED
    ) {
      throw ApiError.conflict('Extraction can only be re-run before the invoice is submitted');
    }
    invoice.status = InvoiceStatus.RECEIVED;
    invoice.extractionAttempts = 0;
    await invoice.save();
    void invoiceService.runExtraction(invoice._id);
    res.status(202).json({ status: 'queued' });
  }),
);

/**
 * Submit for approval — PRD §14 (VALIDATED → SUBMITTED → PENDING_APPROVAL).
 *
 * Validation must be clean first: an unresolved duplicate warning blocks
 * submission, which is the whole point of detecting it before payment.
 */
invoiceRouter.post(
  '/:id/submit',
  requirePermission('invoice:submit'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const invoice = await findScopedDoc(req);

    if (
      invoice.status !== InvoiceStatus.REVIEW_REQUIRED &&
      invoice.status !== InvoiceStatus.VALIDATED
    ) {
      throw ApiError.conflict(`An invoice in ${invoice.status} cannot be submitted`);
    }

    // Re-validate at the moment of submission rather than trusting whatever
    // was computed when the invoice was last edited.
    invoice.findings = await invoiceService.revalidate(invoice);
    invoiceService.assertSubmittable(invoice);

    if (invoice.status === InvoiceStatus.REVIEW_REQUIRED) {
      await invoiceService.transition(invoice, InvoiceStatus.VALIDATED);
    }
    await invoiceService.transition(invoice, InvoiceStatus.SUBMITTED);
    invoice.submittedBy = principal.userId;
    invoice.submittedAt = new Date();
    await invoice.save();

    const { startApproval } = await import('../approvals/approval.service.js');
    const outcome = await startApproval(
      {
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        subjectType: 'VENDOR_INVOICE',
        subjectId: invoice._id,
        subjectLabel: `${invoice.vendorName ?? 'Invoice'} ${invoice.invoiceNumber ?? ''}`.trim(),
        amount: invoice.totalAmount ?? 0,
        requestedByUserId: principal.userId,
        departmentId: invoice.departmentId,
        locationId: invoice.locationId,
        vendorId: invoice.vendorId,
        link: `/invoices/${String(invoice._id)}`,
      },
      auditContext(req),
    );

    if (outcome.request) {
      await invoiceService.transition(invoice, InvoiceStatus.PENDING_APPROVAL);
      invoice.approvalRequestId = outcome.request._id;
      invoice.approvalStatus = 'IN_PROGRESS';
      await invoice.save();
    } else {
      // No rule matched: approve directly and record why in the audit trail.
      await invoiceService.transition(invoice, InvoiceStatus.APPROVED);
      invoice.approvalStatus = 'APPROVED';
      await invoice.save();

      const { createObligationForInvoice } = await import('../payments/obligation.service.js');
      await createObligationForInvoice(invoice._id, auditContext(req));
    }

    await audit.record(
      {
        event: 'invoice.submitted',
        entityType: 'INVOICE',
        entityId: invoice._id,
        entityLabel: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        metadata: {
          amount: invoice.totalAmount,
          approvalRequestId: outcome.request ? String(outcome.request._id) : null,
          autoApprovedReason: outcome.autoApprovedReason,
        },
      },
      auditContext(req),
    );

    const fresh = await Invoice.findById(invoice._id).lean();
    res.json({
      invoice: toApi(fresh),
      approvalRequestId: outcome.request ? String(outcome.request._id) : null,
      autoApprovedReason: outcome.autoApprovedReason,
    });
  }),
);

invoiceRouter.post(
  '/:id/cancel',
  requirePermission('invoice:cancel'),
  validateBody(schemas.cancelInvoiceRequest),
  asyncHandler(async (req, res) => {
    const invoice = await findScopedDoc(req);
    const { reason } = req.body as { reason: string };
    const from = await invoiceService.transition(invoice, InvoiceStatus.CANCELLED);
    await invoice.save();

    const { cancel: cancelApproval } = await import('../approvals/approval.service.js');
    await cancelApproval(invoice._id, reason, auditContext(req));

    await audit.recordStatusChange(
      {
        event: 'invoice.cancelled',
        entityType: 'INVOICE',
        entityId: invoice._id,
        entityLabel: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        from,
        to: InvoiceStatus.CANCELLED,
        reason,
      },
      auditContext(req),
    );

    res.json(toApi(invoice.toObject()));
  }),
);

function viewFilter(view: string | undefined): Record<string, unknown> {
  switch (view) {
    case 'REVIEW':
      return { status: { $in: [InvoiceStatus.REVIEW_REQUIRED, InvoiceStatus.FAILED] } };
    case 'PENDING_APPROVAL':
      return { status: InvoiceStatus.PENDING_APPROVAL };
    case 'APPROVED':
      return { status: InvoiceStatus.APPROVED };
    case 'PAYMENT_PENDING':
      return {
        status: {
          $in: [
            InvoiceStatus.PAYMENT_PENDING,
            InvoiceStatus.PAYMENT_BATCHED,
            InvoiceStatus.PAYMENT_PROCESSING,
          ],
        },
      };
    case 'PAID':
      return { status: { $in: [InvoiceStatus.PAID, InvoiceStatus.RECONCILED] } };
    case 'OVERDUE':
      return {
        dueDate: { $lt: new Date() },
        status: {
          $nin: [
            InvoiceStatus.PAID,
            InvoiceStatus.RECONCILED,
            InvoiceStatus.CANCELLED,
            InvoiceStatus.REJECTED,
            InvoiceStatus.DUPLICATE,
          ],
        },
      };
    default:
      return {};
  }
}

async function findScoped(req: Parameters<typeof requirePrincipal>[0]) {
  const principal = requirePrincipal(req);
  const invoice = await Invoice.findOne({
    _id: objectId(req.params.id),
    ...scopeFilter(principal),
  }).lean();
  if (!invoice) throw ApiError.notFound('Invoice');
  return invoice;
}

async function findScopedDoc(req: Parameters<typeof requirePrincipal>[0]) {
  const principal = requirePrincipal(req);
  const invoice = await Invoice.findOne({
    _id: objectId(req.params.id),
    ...scopeFilter(principal),
  });
  if (!invoice) throw ApiError.notFound('Invoice');
  return invoice;
}

function objectId(value: string | undefined): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid invoice id');
  return new Types.ObjectId(value);
}

export { findScopedDoc as findInvoiceForRequest };
export const INVOICE_FINDING_CODES = { ValidationCode, ValidationSeverity };
