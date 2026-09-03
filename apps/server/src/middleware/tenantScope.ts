import type { FilterQuery } from 'mongoose';
import { Types } from 'mongoose';
import { ApiError } from '../core/errors.js';
import type { Principal } from './types.js';

/**
 * Layer 3 of access control: data scoping.
 *
 * Every read and write goes through one of these helpers, so a service that
 * simply forgets to filter cannot return another tenant's — or another
 * company's — documents. Callers merge the returned filter into their query.
 */
export function scopeFilter(
  principal: Principal,
  requestedCompanyId?: string | Types.ObjectId | undefined,
): FilterQuery<Record<string, unknown>> {
  const filter: FilterQuery<Record<string, unknown>> = { tenantId: principal.tenantId };

  if (requestedCompanyId) {
    filter.companyId = assertCompanyAccess(principal, requestedCompanyId);
  } else if (principal.companyIds.length > 0) {
    // An empty companyIds list means tenant-wide access (platform/company admin).
    filter.companyId = { $in: principal.companyIds };
  }

  return filter;
}

/**
 * Confirms the principal may act within `companyId`, returning it as an
 * ObjectId. Throws 403 rather than 404 so the caller learns it is a
 * permission problem, not a typo.
 */
export function assertCompanyAccess(
  principal: Principal,
  companyId: string | Types.ObjectId,
): Types.ObjectId {
  if (!Types.ObjectId.isValid(companyId)) throw ApiError.badRequest('Invalid companyId');
  const id = new Types.ObjectId(companyId);
  if (principal.companyIds.length === 0) return id;
  if (!principal.companyIds.some((allowed) => allowed.equals(id))) {
    throw ApiError.forbidden('You do not have access to this company');
  }
  return id;
}

/**
 * The company a write should target. Uses the explicit value when given,
 * otherwise the principal's only company; ambiguous cases must be explicit.
 */
export function resolveWriteCompany(
  principal: Principal,
  companyId?: string | Types.ObjectId | undefined,
): Types.ObjectId {
  if (companyId) return assertCompanyAccess(principal, companyId);
  if (principal.companyIds.length === 1) return principal.companyIds[0]!;
  throw ApiError.badRequest('companyId is required');
}

/** Narrows a filter to the locations a principal is restricted to, if any. */
export function applyLocationScope(
  principal: Principal,
  filter: FilterQuery<Record<string, unknown>>,
  requestedLocationId?: string | undefined,
): FilterQuery<Record<string, unknown>> {
  if (requestedLocationId) {
    if (!Types.ObjectId.isValid(requestedLocationId)) throw ApiError.badRequest('Invalid locationId');
    filter.locationId = new Types.ObjectId(requestedLocationId);
  } else if (principal.locationIds.length > 0) {
    filter.locationId = { $in: principal.locationIds };
  }
  return filter;
}
