import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions } from './base.js';

export interface UserDoc {
  tenantId: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  /** Built-in role keys (PRD §7) and the tenant's own, mixed freely. */
  roleKeys: string[];
  /**
   * Organisation scope. Empty on an axis means "unrestricted on that axis" —
   * `companyIds: []` is how a platform admin reaches every company.
   */
  companyIds: Types.ObjectId[];
  groupIds: Types.ObjectId[];
  regionIds: Types.ObjectId[];
  verticalIds: Types.ObjectId[];
  businessUnitIds: Types.ObjectId[];
  locationIds: Types.ObjectId[];
  departmentIds: Types.ObjectId[];
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  lastLoginAt?: Date;
  /** SHA-256 of issued refresh tokens; rotated on every refresh. */
  refreshTokenHashes: Array<{ hash: string; expiresAt: Date; createdAt: Date }>;
  /**
   * Single-use invite token, hashed. An INVITED account cannot sign in, so
   * this is the only way it becomes usable; cleared on acceptance.
   */
  inviteTokenHash?: string;
  inviteTokenExpiresAt?: Date;
}

const schema = new Schema<UserDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    // Not an enum: a tenant's own roles (see `role.model.ts`) are rows, and
    // the assignment is validated against the catalogue in the route instead.
    roleKeys: [{ type: String, required: true }],
    companyIds: [{ type: Schema.Types.ObjectId, ref: 'Company' }],
    groupIds: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
    regionIds: [{ type: Schema.Types.ObjectId, ref: 'Region' }],
    verticalIds: [{ type: Schema.Types.ObjectId, ref: 'Vertical' }],
    businessUnitIds: [{ type: Schema.Types.ObjectId, ref: 'BusinessUnit' }],
    locationIds: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
    departmentIds: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
    status: { type: String, enum: ['ACTIVE', 'INVITED', 'SUSPENDED'], default: 'ACTIVE' },
    lastLoginAt: Date,
    refreshTokenHashes: {
      type: [
        {
          _id: false,
          hash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      select: false,
    },
    inviteTokenHash: { type: String, select: false },
    inviteTokenExpiresAt: { type: Date, select: false },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, email: 1 }, { unique: true });

export const User = model<UserDoc>('User', schema);
