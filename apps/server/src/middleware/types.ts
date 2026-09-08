import type { Permission } from '@fpc/shared';
import type { Types } from 'mongoose';

/**
 * The organisation axes a user's access is granted in.
 *
 * Declared once as a list rather than as seven fields, so the token, the
 * principal, the `/me` response and the user editor all iterate the same
 * source and none of them can quietly omit an axis.
 */
export const ORG_SCOPE_FIELDS = [
  'companyIds',
  'groupIds',
  'regionIds',
  'verticalIds',
  'businessUnitIds',
  'locationIds',
  'departmentIds',
] as const;
export type OrgScopeField = (typeof ORG_SCOPE_FIELDS)[number];

/**
 * Scope as the principal holds it. An empty array on an axis means
 * "unrestricted on that axis" — `companyIds: []` is how a platform admin
 * reaches every company.
 */
export type PrincipalOrgScope = Record<OrgScopeField, Types.ObjectId[]>;

/** The authenticated caller, attached to every request by `authenticate`. */
export interface Principal extends PrincipalOrgScope {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  name: string;
  /** Built-in role keys and the tenant's own, mixed freely. */
  roleKeys: string[];
  permissions: Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      requestId?: string;
      validatedQuery?: unknown;
    }
  }
}

export {};
