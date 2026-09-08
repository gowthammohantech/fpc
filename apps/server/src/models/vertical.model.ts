import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface VerticalDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  code: string;
  /** Resolved by VERTICAL_HEAD approval steps, mirroring Department.headUserId. */
  headUserId?: Types.ObjectId;
  active: boolean;
}

const schema = new Schema<VerticalDoc>(
  {
    ...scopedFields(),
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    headUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, code: 1 }, { unique: true });

export const Vertical = model<VerticalDoc>('Vertical', schema);
