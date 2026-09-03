import { Schema, Types, model } from 'mongoose';
import { ROLE_KEYS, type RoleKey } from '@fpc/shared';
import { baseSchemaOptions } from './base.js';

export interface UserDoc {
  tenantId: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  roleKeys: RoleKey[];
  /** Empty means "every company in the tenant" (used by platform admins). */
  companyIds: Types.ObjectId[];
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
    roleKeys: [{ type: String, enum: ROLE_KEYS, required: true }],
    companyIds: [{ type: Schema.Types.ObjectId, ref: 'Company' }],
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
