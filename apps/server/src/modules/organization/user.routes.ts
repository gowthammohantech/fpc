import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { assertCompanyAccess, assertOrgUnitAccess } from '../../middleware/tenantScope.js';
import { ORG_SCOPE_FIELDS, type OrgScopeField, type Principal } from '../../middleware/types.js';
import { BusinessUnit } from '../../models/businessUnit.model.js';
import { Company } from '../../models/company.model.js';
import { Department } from '../../models/department.model.js';
import { Group } from '../../models/group.model.js';
import { Location } from '../../models/location.model.js';
import { Region } from '../../models/region.model.js';
import { User } from '../../models/user.model.js';
import { Vertical } from '../../models/vertical.model.js';
import { toApi } from '../../models/base.js';
import { audit, auditContext } from '../audit/audit.service.js';
import { hashPassword, issueInviteToken } from '../auth/auth.service.js';
import { escapeRegex } from './crudFactory.js';
import { knownRoleKeys } from './role.service.js';

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
    await assertRolesExist(principal.tenantId, payload.roleKeys);

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
      ...(await resolveScopeAssignment(principal, payload as Record<string, unknown>)),
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
    if (Array.isArray(payload.roleKeys)) {
      await assertRolesExist(principal.tenantId, payload.roleKeys as string[]);
    }
    if (payload.password) {
      payload.passwordHash = await hashPassword(String(payload.password));
      delete payload.password;
      // Giving someone a password has to make the account usable; otherwise
      // an INVITED user is handed credentials that login still refuses.
      if (before.status === 'INVITED' && !payload.status) payload.status = 'ACTIVE';
      payload.inviteTokenHash = undefined;
      payload.inviteTokenExpiresAt = undefined;
    }
    Object.assign(payload, await resolveScopeAssignment(principal, payload));

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
 * Role keys are validated here rather than in the schema: the tenant's own
 * roles are rows, so the closed list is only knowable with a tenant in hand.
 */
async function assertRolesExist(tenantId: Types.ObjectId, roleKeys: string[]): Promise<void> {
  const known = await knownRoleKeys(tenantId);
  const unknown = roleKeys.filter((key) => !known.has(key));
  if (unknown.length) throw ApiError.badRequest(`Unknown role: ${unknown.join(', ')}`);
}

/**
 * Validates and converts the organisation scope being granted to a user.
 *
 * Two checks that were previously missing entirely: every id must belong to
 * this tenant, and it must be inside the *caller's* own scope. Without them a
 * company admin could grant access to another tenant's company simply by
 * naming its id, and a vertical-scoped administrator could grant a vertical
 * they cannot see themselves.
 *
 * Axes absent from the payload are left alone, so a PATCH that only renames a
 * user does not clear their scope.
 */
/** The narrow slice of a Mongoose model this check actually needs. */
interface ExistenceCheck {
  exists(filter: Record<string, unknown>): Promise<{ _id: Types.ObjectId } | null>;
}

const SCOPE_COLLECTIONS: Record<OrgScopeField, { model: ExistenceCheck; label: string }> = {
  companyIds: { model: Company, label: 'company' },
  groupIds: { model: Group, label: 'group' },
  regionIds: { model: Region, label: 'region' },
  verticalIds: { model: Vertical, label: 'vertical' },
  businessUnitIds: { model: BusinessUnit, label: 'business unit' },
  locationIds: { model: Location, label: 'location' },
  departmentIds: { model: Department, label: 'department' },
};

/** `companyIds` has its own assertion; the rest share `assertOrgUnitAccess`. */
const SCOPE_AXIS_OF: Partial<
  Record<
    OrgScopeField,
    'groupId' | 'regionId' | 'verticalId' | 'businessUnitId' | 'locationId' | 'departmentId'
  >
> = {
  groupIds: 'groupId',
  regionIds: 'regionId',
  verticalIds: 'verticalId',
  businessUnitIds: 'businessUnitId',
  locationIds: 'locationId',
  departmentIds: 'departmentId',
};

async function resolveScopeAssignment(
  principal: Principal,
  payload: Record<string, unknown>,
): Promise<Partial<Record<OrgScopeField, Types.ObjectId[]>>> {
  const resolved: Partial<Record<OrgScopeField, Types.ObjectId[]>> = {};

  for (const field of ORG_SCOPE_FIELDS) {
    const raw = payload[field];
    if (!Array.isArray(raw)) continue;

    const { model, label } = SCOPE_COLLECTIONS[field];
    const ids: Types.ObjectId[] = [];
    for (const value of raw as string[]) {
      const axis = SCOPE_AXIS_OF[field];
      const id = axis
        ? assertOrgUnitAccess(principal, axis, value)
        : assertCompanyAccess(principal, value);
      if (!(await model.exists({ _id: id, tenantId: principal.tenantId }))) {
        throw ApiError.badRequest(`Unknown ${label} in the requested access`);
      }
      ids.push(id);
    }
    resolved[field] = ids;
  }

  return resolved;
}
