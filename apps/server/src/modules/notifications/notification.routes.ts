import { Router } from 'express';
import { Types } from 'mongoose';
import { schemas } from '@fpc/shared';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler.js';
import { paginate } from '../../core/paginate.js';
import { query, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { toApi } from '../../models/base.js';
import { Notification } from '../../models/notification.model.js';

const listQuery = schemas.paginationQuery.extend({
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationRouter: Router = Router();

/** A user's own in-app notifications. Never another user's. */
notificationRouter.get(
  '/',
  requirePermission('notification:read'),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof listQuery>(req);

    const filter: Record<string, unknown> = {
      tenantId: principal.tenantId,
      userId: principal.userId,
      channel: 'IN_APP',
    };
    if (q.unreadOnly) filter.readAt = { $exists: false };

    res.json(
      await paginate(
        Notification,
        filter,
        {
          page: q.page,
          pageSize: q.pageSize,
          defaultSort: { createdAt: -1 },
        },
        toApi,
      ),
    );
  }),
);

notificationRouter.get(
  '/unread-count',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    res.json({
      count: await Notification.countDocuments({
        tenantId: principal.tenantId,
        userId: principal.userId,
        channel: 'IN_APP',
        readAt: { $exists: false },
      }),
    });
  }),
);

notificationRouter.post(
  '/:id/read',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    await Notification.updateOne(
      { _id: new Types.ObjectId(req.params.id), userId: principal.userId },
      { readAt: new Date(), status: 'READ' },
    );
    res.status(204).send();
  }),
);

notificationRouter.post(
  '/read-all',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const result = await Notification.updateMany(
      { userId: principal.userId, channel: 'IN_APP', readAt: { $exists: false } },
      { readAt: new Date(), status: 'READ' },
    );
    res.json({ updated: result.modifiedCount });
  }),
);
