import { Router } from 'express';
import { Types } from 'mongoose';
import { schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { assertCompanyAccess } from '../../middleware/tenantScope.js';
import { Company } from '../../models/company.model.js';
import { toApi } from '../../models/base.js';
import { paginate } from '../../core/paginate.js';
import { audit, auditContext } from '../audit/audit.service.js';

export const companyRouter: Router = Router();

/**
 * Companies are scoped by the principal's company list rather than by a
 * companyId filter — this is the collection that defines that list.
 */
companyRouter.get(
  '/',
  requirePermission('company:read'),
  validateQuery(schemas.paginationQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.paginationQuery>(req);
    const filter: Record<string, unknown> = { tenantId: principal.tenantId };
    if (principal.companyIds.length > 0) filter._id = { $in: principal.companyIds };

    res.json(
      await paginate(
        Company,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          sort: q.sort,
          order: q.order,
          defaultSort: { name: 1 },
        },
        (doc) => toApi(doc),
      ),
    );
  }),
);

companyRouter.get(
  '/:id',
  requirePermission('company:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const id = assertCompanyAccess(principal, req.params.id!);
    const company = await Company.findOne({ _id: id, tenantId: principal.tenantId }).lean();
    if (!company) throw ApiError.notFound('Company');
    res.json(toApi(company));
  }),
);

companyRouter.post(
  '/',
  requirePermission('company:create'),
  validateBody(schemas.createCompanyRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as schemas.CreateCompanyRequest;
    const company = await Company.create({ ...payload, tenantId: principal.tenantId });

    await audit.record(
      {
        event: 'company.created',
        entityType: 'COMPANY',
        entityId: company._id,
        entityLabel: company.name,
        tenantId: principal.tenantId,
        companyId: company._id,
        newValue: payload,
      },
      auditContext(req),
    );

    res.status(201).json(toApi(company.toObject()));
  }),
);

companyRouter.patch(
  '/:id',
  requirePermission('company:update'),
  validateBody(schemas.updateCompanyRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const id = assertCompanyAccess(principal, req.params.id!);
    const before = await Company.findOne({ _id: id, tenantId: principal.tenantId }).lean();
    if (!before) throw ApiError.notFound('Company');

    const updated = await Company.findByIdAndUpdate(id, req.body as never, {
      new: true,
      runValidators: true,
    }).lean();

    await audit.record(
      {
        event: 'company.updated',
        entityType: 'COMPANY',
        entityId: id as Types.ObjectId,
        entityLabel: (before as { name: string }).name,
        tenantId: principal.tenantId,
        companyId: id,
        newValue: req.body,
      },
      auditContext(req),
    );

    res.json(toApi(updated));
  }),
);

companyRouter.delete(
  '/:id',
  requirePermission('company:delete'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const id = assertCompanyAccess(principal, req.params.id!);
    await Company.findOneAndUpdate({ _id: id, tenantId: principal.tenantId }, { active: false });
    await audit.record(
      {
        event: 'company.deactivated',
        entityType: 'COMPANY',
        entityId: id,
        tenantId: principal.tenantId,
        companyId: id,
      },
      auditContext(req),
    );
    res.status(204).send();
  }),
);
