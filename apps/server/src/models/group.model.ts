import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions } from './base.js';

/**
 * A group of companies.
 *
 * The only organisation level that sits *above* the legal entity, so it is
 * scoped to the tenant and deliberately does not use `scopedFields()`.
 */
export interface GroupDoc {
  tenantId: Types.ObjectId;
  name: string;
  code: string;
  active: boolean;
}

const schema = new Schema<GroupDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, code: 1 }, { unique: true });

export const Group = model<GroupDoc>('Group', schema);
