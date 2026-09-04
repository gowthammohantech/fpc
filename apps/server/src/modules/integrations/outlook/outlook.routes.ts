import { Router } from 'express';
import { Types } from 'mongoose';
import {
  MailIngestionStatus,
  hasPermission,
  schemas,
  type MailIngestionStatus as MailIngestionStatusType,
} from '@fpc/shared';
import { asyncHandler } from '../../../core/asyncHandler.js';
import { ApiError } from '../../../core/errors.js';
import { paginate } from '../../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../../core/validate.js';
import { requirePrincipal } from '../../../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../../../middleware/requirePermission.js';
import { assertCompanyAccess, scopeFilter } from '../../../middleware/tenantScope.js';
import type { Principal } from '../../../middleware/types.js';
import { Invoice } from '../../../models/invoice.model.js';
import { MailIngestion, type MailIngestionDoc } from '../../../models/mailIngestion.model.js';
import { auditContext } from '../../audit/audit.service.js';
import { escapeRegex } from '../../organization/crudFactory.js';
import * as outlookService from './outlook.service.js';
import * as outlookSync from './outlook.sync.js';

export const outlookRouter: Router = Router();

/**
 * The Invoice Mailbox API.
 *
 * Two permissions guard this router and they are not interchangeable.
 * `mail_connection:manage` is about your own mailbox; `mail_connection:read_all`
 * is oversight and read-only. Because a permission alone cannot express "your
 * own", every mutation additionally asserts ownership — otherwise a manager
 * holding `read_all` could sync somebody else's inbox.
 */

function assertOwner(principal: Principal, ownerId: Types.ObjectId): void {
  if (!ownerId.equals(principal.userId)) {
    throw ApiError.forbidden('You can only manage your own mailbox connection');
  }
}

/** The caller's own connection, or 404 if they have not connected one. */
async function requireOwnConnection(principal: Principal) {
  const connection = await outlookService.findConnection(principal.tenantId, principal.userId);
  if (!connection) throw ApiError.notFound('You have not connected a mailbox yet');
  assertOwner(principal, connection.userId);
  return connection;
}

/**
 * The caller's connection, or null.
 *
 * Returns null rather than 404 because "not connected yet" is the normal first
 * state of this screen, not an error.
 */
outlookRouter.get(
  '/connection',
  requireAnyPermission('mail_connection:manage', 'mail_connection:read_all'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const connection = await outlookService.findConnection(principal.tenantId, principal.userId);
    res.json(connection ? await outlookService.toConnectionApi(connection) : null);
  }),
);

/**
 * Starts the consent flow.
 *
 * Answers with a URL rather than a redirect: the caller is a bearer-token fetch
 * client and cannot follow a redirect that needed its Authorization header.
 */
outlookRouter.post(
  '/authorize',
  requirePermission('mail_connection:manage'),
  validateBody(schemas.connectOutlookRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);

    // Restated here rather than left implicit in the role grants, so a tenant's
    // own custom role cannot connect a mailbox that feeds a queue it may not
    // add to.
    if (!hasPermission(principal.permissions, 'invoice:create')) {
      throw ApiError.forbidden('Connecting a mailbox requires permission to create invoices');
    }

    const body = req.body as schemas.ConnectOutlookRequest;
    const defaultCompanyId = assertCompanyAccess(principal, body.defaultCompanyId);

    res.json(
      await outlookService.buildAuthorizeUrl({
        userId: principal.userId,
        tenantId: principal.tenantId,
        defaultCompanyId,
      }),
    );
  }),
);

outlookRouter.patch(
  '/connection',
  requirePermission('mail_connection:manage'),
  validateBody(schemas.updateMailConnectionRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const connection = await requireOwnConnection(principal);
    const body = req.body as schemas.UpdateMailConnectionRequest;

    if (body.defaultCompanyId) assertCompanyAccess(principal, body.defaultCompanyId);

    const updated = await outlookService.updateConnection(connection, body, auditContext(req));
    res.json(await outlookService.toConnectionApi(updated));
  }),
);

outlookRouter.delete(
  '/connection',
  requirePermission('mail_connection:manage'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const connection = await requireOwnConnection(principal);
    await outlookService.disconnect(connection, auditContext(req));
    res.status(204).end();
  }),
);

/**
 * Manual sync.
 *
 * 202: the run continues in the background and the screen watches the ingestion
 * rows fill in. A second press while one is running is a 409, not a queued run.
 */
outlookRouter.post(
  '/sync',
  requirePermission('mail_connection:manage'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const connection = await requireOwnConnection(principal);
    const started = await outlookSync.startSync(connection._id, auditContext(req));
    res.status(202).json(started);
  }),
);

/** Statuses each tab of the screen selects. */
const VIEW_STATUSES: Record<string, MailIngestionStatusType[]> = {
  IN_PROGRESS: [MailIngestionStatus.PENDING, MailIngestionStatus.PROCESSING],
  READY: [MailIngestionStatus.COMPLETED, MailIngestionStatus.PARTIAL],
  SKIPPED: [MailIngestionStatus.SKIPPED],
  FAILED: [MailIngestionStatus.FAILED],
};

outlookRouter.get(
  '/ingestions',
  requireAnyPermission('mail_connection:manage', 'mail_connection:read_all'),
  validateQuery(schemas.mailIngestionListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.mailIngestionListQuery>(req);
    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;

    // Oversight is opt-in per request: without `read_all` the list is narrowed
    // to your own mailbox regardless of what the query asks for.
    const canReadAll = hasPermission(principal.permissions, 'mail_connection:read_all');
    if (!canReadAll) {
      filter.userId = principal.userId;
    } else if (q.userId) {
      filter.userId = new Types.ObjectId(q.userId);
    }

    if (q.connectionId) filter.connectionId = new Types.ObjectId(q.connectionId);
    if (q.syncRunId) filter.syncRunId = q.syncRunId;

    const viewStatuses = VIEW_STATUSES[q.view];
    if (viewStatuses) filter.status = { $in: viewStatuses };
    if (q.status) filter.status = { $in: Array.isArray(q.status) ? q.status : [q.status] };

    if (q.q) {
      const pattern = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ subject: pattern }, { fromAddress: pattern }, { fromName: pattern }];
    }
    if (q.dateFrom || q.dateTo) {
      filter.receivedAt = {
        ...(q.dateFrom ? { $gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { $lte: new Date(q.dateTo) } : {}),
      };
    }

    const page = await paginate<MailIngestionDoc>(MailIngestion, filter, {
      page: q.page,
      pageSize: q.pageSize,
      ...(q.sort ? { sort: q.sort } : {}),
      order: q.order,
      defaultSort: { receivedAt: -1 },
    });

    res.json({ ...page, items: await withInvoices(page.items as MailIngestionDoc[]) });
  }),
);

outlookRouter.get(
  '/ingestions/:id',
  requireAnyPermission('mail_connection:manage', 'mail_connection:read_all'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const filter = scopeFilter(principal) as Record<string, unknown>;
    filter._id = req.params.id;
    if (!hasPermission(principal.permissions, 'mail_connection:read_all')) {
      filter.userId = principal.userId;
    }

    const ingestion = await MailIngestion.findOne(filter).lean<MailIngestionDoc>();
    if (!ingestion) throw ApiError.notFound('Email not found');

    const [row] = await withInvoices([ingestion]);
    res.json(row);
  }),
);

/**
 * Retries one email.
 *
 * Re-runs extraction on the invoices this email already produced rather than
 * re-fetching from the mailbox: the documents are already stored, and the usual
 * reason to retry is a transient extraction failure.
 */
outlookRouter.post(
  '/ingestions/:id/retry',
  requirePermission('mail_connection:manage'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const filter = scopeFilter(principal) as Record<string, unknown>;
    filter._id = req.params.id;
    filter.userId = principal.userId;

    const ingestion = await MailIngestion.findOne(filter);
    if (!ingestion) throw ApiError.notFound('Email not found');

    const updated = await outlookSync.retryIngestion(ingestion._id, auditContext(req));
    const [row] = await withInvoices([updated]);
    res.json(row);
  }),
);

/**
 * Joins live invoice state onto the attachment rows.
 *
 * Deliberately a join rather than a denormalised copy: the invoice moves on
 * after review, and the screen should follow it without anything having to keep
 * the two in step.
 */
async function withInvoices(rows: MailIngestionDoc[]): Promise<unknown[]> {
  const ids = rows.flatMap((row) =>
    (row.attachments ?? []).map((a) => a.invoiceId).filter(Boolean),
  ) as Types.ObjectId[];

  const invoices = ids.length
    ? await Invoice.find({ _id: { $in: ids } })
        .select('_id status invoiceNumber vendorName totalAmount')
        .lean()
    : [];
  const byId = new Map(invoices.map((invoice) => [String(invoice._id), invoice]));

  return rows.map((row) => ({
    id: String((row as unknown as { _id: Types.ObjectId })._id),
    tenantId: String(row.tenantId),
    companyId: String(row.companyId),
    connectionId: String(row.connectionId),
    userId: String(row.userId),
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    internetMessageId: row.internetMessageId,
    subject: row.subject,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    toAddresses: row.toAddresses ?? [],
    receivedAt: row.receivedAt?.toISOString(),
    bodyPreview: row.bodyPreview,
    folderName: row.folderName,
    webLink: row.webLink,
    status: row.status,
    skipReason: row.skipReason,
    error: row.error,
    attachmentCount: row.attachmentCount,
    processedCount: row.processedCount,
    syncRunId: row.syncRunId,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    attachments: (row.attachments ?? []).map((attachment) => {
      const invoice = attachment.invoiceId ? byId.get(String(attachment.invoiceId)) : undefined;
      return {
        name: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size,
        status: attachment.status,
        skipReason: attachment.skipReason,
        messageKey: attachment.messageKey,
        invoiceId: attachment.invoiceId ? String(attachment.invoiceId) : undefined,
        error: attachment.error,
        extractionStartedAt: attachment.extractionStartedAt?.toISOString(),
        extractionCompletedAt: attachment.extractionCompletedAt?.toISOString(),
        invoice: invoice
          ? {
              id: String(invoice._id),
              status: invoice.status,
              invoiceNumber: invoice.invoiceNumber,
              vendorName: invoice.vendorName,
              totalAmount: invoice.totalAmount,
            }
          : null,
      };
    }),
  }));
}
