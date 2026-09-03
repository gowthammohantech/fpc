import type { NextFunction, Request, Response } from 'express';
import { hasAnyPermission, hasPermission, type Permission } from '@fpc/shared';
import { ApiError } from '../core/errors.js';

/**
 * Layer 2 of access control: does this principal hold the permission this
 * route needs?
 *
 * The permission strings come from `@fpc/shared`, which the web and mobile
 * clients also use to decide what to render — so the UI can never offer an
 * action that the API will reject.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.principal) {
      next(ApiError.unauthorized());
      return;
    }
    if (!hasPermission(req.principal.permissions, permission)) {
      next(ApiError.forbidden(`Missing permission: ${permission}`));
      return;
    }
    next();
  };
}

/** Passes when the caller holds any one of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.principal) {
      next(ApiError.unauthorized());
      return;
    }
    if (!hasAnyPermission(req.principal.permissions, permissions)) {
      next(ApiError.forbidden(`Missing one of: ${permissions.join(', ')}`));
      return;
    }
    next();
  };
}
