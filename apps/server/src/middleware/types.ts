import type { Permission, RoleKey } from '@fpc/shared';
import type { Types } from 'mongoose';

/** The authenticated caller, attached to every request by `authenticate`. */
export interface Principal {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  name: string;
  roleKeys: RoleKey[];
  permissions: Permission[];
  /** Companies this user may act within. Empty means all in the tenant. */
  companyIds: Types.ObjectId[];
  locationIds: Types.ObjectId[];
  departmentIds: Types.ObjectId[];
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
