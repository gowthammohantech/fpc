import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { paginate } from '../../core/paginate.js';
import { toApi } from '../../models/base.js';
import { AuditEvent } from '../../models/auditEvent.model.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { scopeFilter } from '../../middleware/tenantScope.js';
import { query, validateQuery } from '../../core/validate.js';

const listQuery = schemas.paginationQuery.extend({
  companyId: schemas.objectId.optional(),
  entityType: z.string().optional(),
  entityId: schemas.objectId.optional(),
  userId: schemas.objectId.optional(),
  event: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const auditRouter: Router = Router();

/**
 * Read-only by design. There is deliberately no POST/PATCH/DELETE here —
 * audit records are written by services and are immutable (PRD §29).
 */
auditRouter.get(
  '/',
  requirePermission('audit:read'),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof listQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    if (q.entityType) filter.entityType = q.entityType;
    if (q.entityId) filter.entityId = new Types.ObjectId(q.entityId);
    if (q.userId) filter.userId = new Types.ObjectId(q.userId);
    if (q.event) filter.event = q.event;
    if (q.dateFrom || q.dateTo) {
      filter.timestamp = {
        ...(q.dateFrom ? { $gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { $lte: new Date(q.dateTo) } : {}),
      };
    }

    // Audit events for a company are scoped, but tenant-level events (login,
    // user administration) carry no companyId and must still be visible.
    if (filter.companyId) {
      filter.$or = [{ companyId: filter.companyId }, { companyId: { $exists: false } }];
      delete filter.companyId;
    }

    res.json(
      await paginate(AuditEvent, filter, {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort ?? 'timestamp',
        order: q.order,
        defaultSort: { timestamp: -1 },
      }, (doc) => toApi(doc)),
    );
  }),
);

/** Timeline for a single entity — powers the audit panel on detail screens. */
auditRouter.get(
  '/entity/:entityType/:entityId',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const events = await AuditEvent.find({
      tenantId: principal.tenantId,
      entityType: req.params.entityType,
      entityId: new Types.ObjectId(req.params.entityId),
    })
      .sort({ timestamp: 1 })
      .lean();
    res.json({ items: events.map((doc) => toApi(doc)) });
  }),
);
