import { Router } from 'express';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { ZodTypeAny } from 'zod';
import type { EntityType, Permission } from '@fpc/shared';
import { schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { resolveWriteCompany, scopeFilter } from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { audit, auditContext } from '../audit/audit.service.js';

/**
 * Builds a scoped CRUD router for the simple administration collections
 * (locations, departments, vendors, bank accounts).
 *
 * The point is that tenant/company scoping, permission gating and audit
 * writing are applied uniformly and cannot be forgotten in one resource — not
 * to abstract away anything with real domain behaviour, which each get their
 * own hand-written module.
 */
export interface CrudConfig<T> {
  model: Model<T>;
  entityType: EntityType;
  /** Used in audit events and error messages, e.g. "location". */
  name: string;
  permissions: {
    read: Permission;
    create: Permission;
    update: Permission;
    delete: Permission;
  };
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  listQuerySchema?: ZodTypeAny;
  /** Extra filter derived from the parsed query. */
  buildFilter?: (q: Record<string, unknown>) => Record<string, unknown>;
  /** Hook to derive stored fields from the validated payload. */
  beforeCreate?: (
    payload: Record<string, unknown>,
    ctx: { tenantId: Types.ObjectId; companyId: Types.ObjectId },
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  defaultSort?: Record<string, 1 | -1>;
  /** Labels the record in the audit trail. */
  label?: (doc: Record<string, unknown>) => string;
}

export function crudRouter<T>(config: CrudConfig<T>): Router {
  const router: Router = Router();
  const listSchema = config.listQuerySchema ?? schemas.paginationQuery.merge(schemas.scopeQuery);
  const label = config.label ?? ((doc) => String(doc.name ?? doc.label ?? doc._id));

  router.get(
    '/',
    requirePermission(config.permissions.read),
    validateQuery(listSchema),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const q = query(req) as Record<string, any>;
      const filter = {
        ...scopeFilter(principal, q.companyId),
        ...(config.buildFilter?.(q) ?? {}),
      };
      if (q.q) filter.name = { $regex: escapeRegex(String(q.q)), $options: 'i' };

      res.json(
        await paginate(
          config.model,
          filter as never,
          {
            page: q.page,
            pageSize: q.pageSize,
            sort: q.sort,
            order: q.order,
            defaultSort: config.defaultSort ?? { name: 1 },
          },
          (doc) => toApi(doc),
        ),
      );
    }),
  );

  router.get(
    '/:id',
    requirePermission(config.permissions.read),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const doc = await config.model
        .findOne({ _id: toId(req.params.id), ...scopeFilter(principal) } as never)
        .lean();
      if (!doc) throw ApiError.notFound(config.name);
      res.json(toApi(doc));
    }),
  );

  router.post(
    '/',
    requirePermission(config.permissions.create),
    validateBody(config.createSchema),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const payload = req.body as Record<string, unknown>;
      const companyId = resolveWriteCompany(principal, payload.companyId as string | undefined);

      const prepared = config.beforeCreate
        ? await config.beforeCreate(payload, { tenantId: principal.tenantId, companyId })
        : payload;

      const [doc] = await config.model.create([
        { ...prepared, tenantId: principal.tenantId, companyId },
      ] as never[]);
      const plain = (doc as { toObject: () => Record<string, unknown> }).toObject();
      await audit.record(
        {
          event: `${config.name}.created`,
          entityType: config.entityType,
          entityId: (doc as { _id: Types.ObjectId })._id,
          entityLabel: label(plain),
          tenantId: principal.tenantId,
          companyId,
          newValue: redact(plain),
        },
        auditContext(req),
      );

      res.status(201).json(toApi(plain));
    }),
  );

  router.patch(
    '/:id',
    requirePermission(config.permissions.update),
    validateBody(config.updateSchema),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const existing = await config.model
        .findOne({ _id: toId(req.params.id), ...scopeFilter(principal) } as never)
        .lean();
      if (!existing) throw ApiError.notFound(config.name);

      const updated = await config.model
        .findByIdAndUpdate((existing as { _id: Types.ObjectId })._id, req.body as never, {
          new: true,
          runValidators: true,
        })
        .lean();

      await audit.record(
        {
          event: `${config.name}.updated`,
          entityType: config.entityType,
          entityId: (existing as { _id: Types.ObjectId })._id,
          entityLabel: label(existing as Record<string, unknown>),
          tenantId: principal.tenantId,
          companyId: (existing as { companyId?: Types.ObjectId }).companyId,
          oldValue: redact(pick(existing as Record<string, unknown>, Object.keys(req.body as object))),
          newValue: redact(req.body as Record<string, unknown>),
        },
        auditContext(req),
      );

      res.json(toApi(updated));
    }),
  );

  router.delete(
    '/:id',
    requirePermission(config.permissions.delete),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const existing = await config.model
        .findOne({ _id: toId(req.params.id), ...scopeFilter(principal) } as never)
        .lean();
      if (!existing) throw ApiError.notFound(config.name);

      // Soft delete: financial records reference these, so rows are
      // deactivated rather than removed.
      await config.model.findByIdAndUpdate((existing as { _id: Types.ObjectId })._id, {
        active: false,
      } as never);

      await audit.record(
        {
          event: `${config.name}.deactivated`,
          entityType: config.entityType,
          entityId: (existing as { _id: Types.ObjectId })._id,
          entityLabel: label(existing as Record<string, unknown>),
          tenantId: principal.tenantId,
          companyId: (existing as { companyId?: Types.ObjectId }).companyId,
        },
        auditContext(req),
      );

      res.status(204).send();
    }),
  );

  return router;
}

function toId(value: string | undefined): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid id');
  return new Types.ObjectId(value);
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

/** Keeps credentials and full bank numbers out of the audit trail. */
function redact(value: Record<string, unknown>): Record<string, unknown> {
  const { password, passwordHash, refreshTokenHashes, ...rest } = value;
  if (typeof rest.bankAccountNumber === 'string') {
    rest.bankAccountNumber = maskAccount(rest.bankAccountNumber);
  }
  if (typeof rest.accountNumber === 'string') {
    rest.accountNumber = maskAccount(rest.accountNumber);
  }
  return rest;
}

function maskAccount(value: string): string {
  return value.length <= 4 ? value : `${'X'.repeat(value.length - 4)}${value.slice(-4)}`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
