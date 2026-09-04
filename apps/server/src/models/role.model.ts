import { Schema, Types, model } from 'mongoose';
import { PERMISSIONS, type Permission } from '@fpc/shared';
import { baseSchemaOptions } from './base.js';

/**
 * A role a tenant defined for itself.
 *
 * The eight roles of PRD §7 stay in code — they are what the seed data, the
 * approval ladders and the tests are written against — and these rows sit
 * alongside them. Only the grant list is stored: everything downstream still
 * asks "does this principal hold this permission?", so a custom role is
 * enforced by exactly the same middleware as a built-in one.
 */
export interface RoleDoc {
  tenantId: Types.ObjectId;
  /** Uppercase, unique within the tenant, and never one of the built-in keys. */
  key: string;
  label: string;
  description?: string;
  permissions: Permission[];
  active: boolean;
}

const schema = new Schema<RoleDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    key: { type: String, required: true, uppercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    permissions: [{ type: String, enum: [...PERMISSIONS], required: true }],
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const Role = model<RoleDoc>('Role', schema);
