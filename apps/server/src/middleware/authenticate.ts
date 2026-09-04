import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../core/errors.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import { resolvePermissions } from '../modules/organization/role.service.js';
import type { Principal } from './types.js';

/**
 * Layer 1 of access control: establish who is calling.
 *
 * Permissions are derived from the user's roles at request time rather than
 * being read out of the token, so a role change — including an edit to one of
 * the tenant's own roles — takes effect on the next request instead of waiting
 * for the access token to expire.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(ApiError.unauthorized());
    return;
  }

  let claims;
  try {
    claims = verifyAccessToken(header.slice(7).trim());
  } catch {
    next(ApiError.unauthorized('Session expired or token invalid'));
    return;
  }

  const tenantId = new Types.ObjectId(claims.tenantId);
  // Custom roles live in the database, so this leg is asynchronous; it costs
  // no query at all when every role the caller holds is built in.
  resolvePermissions(tenantId, claims.roleKeys)
    .then((permissions) => {
      const principal: Principal = {
        userId: new Types.ObjectId(claims.sub),
        tenantId,
        email: claims.email,
        name: claims.name,
        roleKeys: claims.roleKeys,
        permissions,
        companyIds: claims.companyIds.map((id) => new Types.ObjectId(id)),
        locationIds: claims.locationIds.map((id) => new Types.ObjectId(id)),
        departmentIds: claims.departmentIds.map((id) => new Types.ObjectId(id)),
      };
      req.principal = principal;
      next();
    })
    .catch(next);
}

/** Throws if the request has no principal. Use inside services. */
export function requirePrincipal(req: Request): Principal {
  if (!req.principal) throw ApiError.unauthorized();
  return req.principal;
}
