import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface RegionDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  code: string;
  active: boolean;
}

const schema = new Schema<RegionDoc>(
  {
    ...scopedFields(),
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, code: 1 }, { unique: true });

export const Region = model<RegionDoc>('Region', schema);
