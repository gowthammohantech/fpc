import type { FilterQuery } from 'mongoose';
import { Types } from 'mongoose';
import { ApiError } from '../core/errors.js';
import type { OrgScopeField, Principal } from './types.js';

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

/**
 * The organisation axes a business document can be narrowed on, outermost
 * first, each paired with the principal field that governs it.
 *
 * `companyId` is not here: it has its own helpers above because it is also the
 * write target and the switcher's subject.
 */
export const ORG_SCOPE_AXES = {
  groupId: 'groupIds',
  regionId: 'regionIds',
  verticalId: 'verticalIds',
  businessUnitId: 'businessUnitIds',
  locationId: 'locationIds',
  departmentId: 'departmentIds',
} as const satisfies Record<string, OrgScopeField>;

export type OrgScopeAxis = keyof typeof ORG_SCOPE_AXES;
export const ORG_SCOPE_AXIS_NAMES = Object.keys(ORG_SCOPE_AXES) as OrgScopeAxis[];

/** The axis values a caller asked to filter by, as they arrive on the query. */
export type OrgScopeRequest = Partial<Record<OrgScopeAxis, string | undefined>>;

/**
 * Confirms the principal may act within one organisation unit.
 *
 * The counterpart of `assertCompanyAccess`, and the reason a requested filter
 * value can be trusted: a caller restricted to one vertical asking for another
 * gets a 403 rather than the other vertical's rows.
 */
export function assertOrgUnitAccess(
  principal: Principal,
  axis: OrgScopeAxis,
  value: string | Types.ObjectId,
): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw ApiError.badRequest(`Invalid ${axis}`);
  const id = new Types.ObjectId(value);
  const granted = principal[ORG_SCOPE_AXES[axis]];
  // Unrestricted on this axis.
  if (granted.length === 0) return id;
  if (!granted.some((allowed) => allowed.equals(id))) {
    throw ApiError.forbidden(`You do not have access to this ${axisLabel(axis)}`);
  }
  return id;
}

/**
 * Narrows a filter to every organisation axis the principal is restricted to,
 * and applies the axis values the caller asked for.
 *
 * Replaces the earlier `applyLocationScope`, which took the requested location
 * on trust: a user scoped to one location could read another simply by naming
 * it in the query string. Every requested value now goes through
 * `assertOrgUnitAccess` first.
 *
 * A restricted principal sees only documents that carry an id it holds — a
 * document with no `verticalId` is invisible to a vertical-scoped user. That
 * is the safe default, and it is why the seed sets every axis it can.
 */
export function applyOrgScope(
  principal: Principal,
  filter: FilterQuery<Record<string, unknown>>,
  requested?: OrgScopeRequest,
): FilterQuery<Record<string, unknown>> {
  for (const axis of ORG_SCOPE_AXIS_NAMES) {
    const asked = requested?.[axis];
    if (asked) {
      filter[axis] = assertOrgUnitAccess(principal, axis, asked);
      continue;
    }
    const granted = principal[ORG_SCOPE_AXES[axis]];
    if (granted.length > 0) filter[axis] = { $in: granted };
  }
  return filter;
}

/** True when the principal is restricted on at least one axis below company. */
export function hasOrgRestrictions(principal: Principal): boolean {
  return ORG_SCOPE_AXIS_NAMES.some((axis) => principal[ORG_SCOPE_AXES[axis]].length > 0);
}

function axisLabel(axis: OrgScopeAxis): string {
  return axis.replace(/Id$/, '').replace(/([A-Z])/g, (m) => ` ${m.toLowerCase()}`);
}
