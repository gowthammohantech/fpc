import { Router } from 'express';
import { Types } from 'mongoose';
import { isSystemRoleKey, schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { validateBody } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { Role, type RoleDoc } from '../../models/role.model.js';
import { User } from '../../models/user.model.js';
import { audit, auditContext } from '../audit/audit.service.js';
import { deriveRoleKey, invalidateRoleCache, roleCatalogue } from './role.service.js';

export const roleRouter: Router = Router();

/**
 * The role catalogue: the eight built into the product (PRD §7) followed by
 * whatever this tenant defined for itself.
 *
 * `userCount` is what the settings screen uses to explain why a role cannot be
 * deleted, so it is computed here rather than guessed in the client.
 */
roleRouter.get(
  '/',
  requirePermission('role:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const [roles, counts] = await Promise.all([
      roleCatalogue(principal.tenantId),
      countUsersByRole(principal.tenantId),
    ]);

    res.json({
      items: roles.map((role) => ({
        ...role,
        permissionCount: role.permissions.length,
        userCount: counts.get(role.key) ?? 0,
      })),
    });
  }),
);

roleRouter.post(
  '/',
  requirePermission('role:create'),
  validateBody(schemas.createRoleRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as schemas.CreateRoleRequest;

    const key = payload.key ?? deriveRoleKey(payload.label);
    if (!schemas.roleKey.safeParse(key).success) {
      throw ApiError.badRequest(
        `Could not derive a role key from "${payload.label}". Supply one explicitly.`,
      );
    }
    if (isSystemRoleKey(key)) {
      throw ApiError.conflict(`${key} is a built-in role. Choose a different name.`);
    }
    if (await Role.exists({ tenantId: principal.tenantId, key })) {
      throw ApiError.conflict(`A role with the key ${key} already exists`);
    }
    const role = await Role.create({
      tenantId: principal.tenantId,
      key,
      label: payload.label,
      description: payload.description,
      permissions: payload.permissions,
    });
    invalidateRoleCache(principal.tenantId);

    await audit.record(
      {
        event: 'role.created',
        entityType: 'ROLE',
        entityId: role._id,
        entityLabel: role.label,
        tenantId: principal.tenantId,
        newValue: { key: role.key, permissions: role.permissions },
      },
      auditContext(req),
    );

    res.status(201).json(toRoleView(role.toObject(), 0));
  }),
);

roleRouter.patch(
  '/:id',
  requirePermission('role:update'),
  validateBody(schemas.updateRoleRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as schemas.UpdateRoleRequest;

    const before = await requireCustomRole(req.params.id, principal.tenantId);

    const updated = await Role.findByIdAndUpdate(before._id, payload, {
      new: true,
      runValidators: true,
    }).lean();
    invalidateRoleCache(principal.tenantId);

    await audit.record(
      {
        event: 'role.updated',
        entityType: 'ROLE',
        entityId: before._id,
        entityLabel: before.label,
        tenantId: principal.tenantId,
        oldValue: { permissions: before.permissions, active: before.active },
        newValue: { permissions: updated?.permissions, active: updated?.active },
      },
      auditContext(req),
    );

    const counts = await countUsersByRole(principal.tenantId);
    res.json(toRoleView(updated!, counts.get(before.key) ?? 0));
  }),
);

/**
 * Deletes a custom role.
 *
 * Refused while anyone still holds it: removing the row would silently strip
 * those users of every permission it granted, which is the kind of change that
 * should be a deliberate edit to each account.
 */
roleRouter.delete(
  '/:id',
  requirePermission('role:delete'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const role = await requireCustomRole(req.params.id, principal.tenantId);

    const assigned = await User.countDocuments({
      tenantId: principal.tenantId,
      roleKeys: role.key,
    });
    if (assigned > 0) {
      throw ApiError.conflict(
        `${assigned} user${assigned === 1 ? '' : 's'} still hold this role. Reassign them first.`,
      );
    }

    await Role.deleteOne({ _id: role._id });
    invalidateRoleCache(principal.tenantId);

    await audit.record(
      {
        event: 'role.deleted',
        entityType: 'ROLE',
        entityId: role._id,
        entityLabel: role.label,
        tenantId: principal.tenantId,
        oldValue: { key: role.key, permissions: role.permissions },
      },
      auditContext(req),
    );

    res.status(204).send();
  }),
);

async function requireCustomRole(id: string | undefined, tenantId: Types.ObjectId) {
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.notFound('Role');
  const role = await Role.findOne({ _id: new Types.ObjectId(id), tenantId }).lean();
  // Built-in roles have no row, so they land here rather than in a 200 that
  // pretended to save.
  if (!role) throw ApiError.notFound('Role');
  return role;
}

async function countUsersByRole(tenantId: Types.ObjectId): Promise<Map<string, number>> {
  const rows = await User.aggregate<{ _id: string; count: number }>([
    { $match: { tenantId } },
    { $unwind: '$roleKeys' },
    { $group: { _id: '$roleKeys', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.count]));
}

function toRoleView(role: RoleDoc & { _id: Types.ObjectId }, userCount: number) {
  return {
    id: String(role._id),
    key: role.key,
    label: role.label,
    description: role.description,
    permissions: role.permissions,
    permissionCount: role.permissions.length,
    system: false,
    active: role.active,
    userCount,
  };
}
