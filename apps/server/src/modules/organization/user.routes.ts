import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { ROLE_PERMISSIONS, ROLE_LABELS, ROLE_KEYS, schemas, type RoleKey } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { User } from '../../models/user.model.js';
import { toApi } from '../../models/base.js';
import { audit, auditContext } from '../audit/audit.service.js';
import { hashPassword, issueInviteToken } from '../auth/auth.service.js';
import { escapeRegex } from './crudFactory.js';

export const userRouter: Router = Router();

const listQuery = schemas.paginationQuery.extend({
  companyId: schemas.objectId.optional(),
  roleKey: schemas.objectId.or(schemas.paginationQuery.shape.sort).optional(),
  q: schemas.scopeQuery.shape.q,
});

userRouter.get(
  '/',
  requirePermission('user:read'),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof listQuery>(req);
    const filter: Record<string, unknown> = { tenantId: principal.tenantId };
    if (q.companyId) filter.companyIds = new Types.ObjectId(q.companyId);
    if (q.roleKey) filter.roleKeys = q.roleKey;
    if (q.q) {
      const pattern = { $regex: escapeRegex(q.q), $options: 'i' };
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    res.json(
      await paginate(
        User,
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

userRouter.post(
  '/',
  requirePermission('user:create'),
  validateBody(schemas.createUserRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as schemas.CreateUserRequest;

    if (await User.exists({ tenantId: principal.tenantId, email: payload.email })) {
      throw ApiError.conflict('A user with this email already exists');
    }

    // Without an explicit password the account starts INVITED and is unusable
    // until the invitation is redeemed, so an invite token is issued below.
    const generated = !payload.password;
    const password = payload.password ?? randomBytes(18).toString('base64url');

    const user = await User.create({
      tenantId: principal.tenantId,
      name: payload.name,
      email: payload.email,
      passwordHash: await hashPassword(password),
      roleKeys: payload.roleKeys,
      companyIds: payload.companyIds.map((id) => new Types.ObjectId(id)),
      locationIds: payload.locationIds.map((id) => new Types.ObjectId(id)),
      departmentIds: payload.departmentIds.map((id) => new Types.ObjectId(id)),
      status: generated ? 'INVITED' : 'ACTIVE',
    });

    await audit.record(
      {
        event: 'user.created',
        entityType: 'USER',
        entityId: user._id,
        entityLabel: user.email,
        tenantId: principal.tenantId,
        newValue: { email: user.email, roleKeys: user.roleKeys, status: user.status },
      },
      auditContext(req),
    );

    // The token is the only way an INVITED account becomes usable, and it is
    // returned exactly once — it is stored hashed.
    const inviteToken = generated ? await issueInviteToken(user._id) : undefined;

    res.status(201).json({
      ...toApi(user.toObject()),
      ...(inviteToken ? { inviteToken, inviteUrl: `/accept-invite?token=${inviteToken}` } : {}),
    });
  }),
);

userRouter.patch(
  '/:id',
  requirePermission('user:update'),
  validateBody(schemas.updateUserRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const before = await User.findOne({
      _id: new Types.ObjectId(req.params.id),
      tenantId: principal.tenantId,
    }).lean();
    if (!before) throw ApiError.notFound('User');

    const payload = { ...(req.body as Record<string, unknown>) };
    if (payload.password) {
      payload.passwordHash = await hashPassword(String(payload.password));
      delete payload.password;
      // Giving someone a password has to make the account usable; otherwise
      // an INVITED user is handed credentials that login still refuses.
      if (before.status === 'INVITED' && !payload.status) payload.status = 'ACTIVE';
      payload.inviteTokenHash = undefined;
      payload.inviteTokenExpiresAt = undefined;
    }
    for (const key of ['companyIds', 'locationIds', 'departmentIds'] as const) {
      if (Array.isArray(payload[key])) {
        payload[key] = (payload[key] as string[]).map((id) => new Types.ObjectId(id));
      }
    }

    const updated = await User.findByIdAndUpdate(before._id, payload, {
      new: true,
      runValidators: true,
    }).lean();

    await audit.record(
      {
        event: 'user.updated',
        entityType: 'USER',
        entityId: before._id,
        entityLabel: before.email,
        tenantId: principal.tenantId,
        oldValue: { roleKeys: before.roleKeys, status: before.status },
        newValue: { roleKeys: updated?.roleKeys, status: updated?.status },
      },
      auditContext(req),
    );

    res.json(toApi(updated));
  }),
);

/**
 * Reissues an invitation, for the common case of one that expired or was
 * lost before it was redeemed.
 */
userRouter.post(
  '/:id/reinvite',
  requirePermission('user:update'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const user = await User.findOne({
      _id: new Types.ObjectId(req.params.id),
      tenantId: principal.tenantId,
    }).lean();
    if (!user) throw ApiError.notFound('User');
    if (user.status === 'SUSPENDED') {
      throw ApiError.conflict('Reactivate this account before inviting them again');
    }

    const inviteToken = await issueInviteToken(user._id);

    await audit.record(
      {
        event: 'user.reinvited',
        entityType: 'USER',
        entityId: user._id,
        entityLabel: user.email,
        tenantId: principal.tenantId,
      },
      auditContext(req),
    );

    res.json({ inviteToken, inviteUrl: `/accept-invite?token=${inviteToken}` });
  }),
);

userRouter.delete(
  '/:id',
  requirePermission('user:delete'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const id = new Types.ObjectId(req.params.id);
    if (id.equals(principal.userId))
      throw ApiError.badRequest('You cannot suspend your own account');

    const user = await User.findOneAndUpdate(
      { _id: id, tenantId: principal.tenantId },
      { status: 'SUSPENDED', refreshTokenHashes: [] },
    );
    if (!user) throw ApiError.notFound('User');

    await audit.record(
      {
        event: 'user.suspended',
        entityType: 'USER',
        entityId: id,
        entityLabel: user.email,
        tenantId: principal.tenantId,
      },
      auditContext(req),
    );
    res.status(204).send();
  }),
);

/**
 * The role catalogue. Roles are fixed in code rather than editable rows —
 * the MVP defines exactly the eight roles in PRD §7, and this endpoint lets
 * the settings screen show what each one can do.
 */
export const roleRouter: Router = Router();

roleRouter.get(
  '/',
  requirePermission('role:read'),
  asyncHandler(async (_req, res) => {
    res.json({
      items: ROLE_KEYS.map((key) => ({
        key,
        label: ROLE_LABELS[key as RoleKey],
        permissions: ROLE_PERMISSIONS[key as RoleKey],
        permissionCount: ROLE_PERMISSIONS[key as RoleKey].length,
      })),
    });
  }),
);
