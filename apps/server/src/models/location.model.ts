import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface LocationDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  code: string;
  city?: string;
  state?: string;
  active: boolean;
}

const schema = new Schema<LocationDoc>(
  {
    ...scopedFields(),
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, code: 1 }, { unique: true });

export const Location = model<LocationDoc>('Location', schema);
