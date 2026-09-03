import { Schema, model } from 'mongoose';
import { baseSchemaOptions } from './base.js';

export interface TenantDoc {
  name: string;
  slug: string;
  active: boolean;
}

const schema = new Schema<TenantDoc>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

export const Tenant = model<TenantDoc>('Tenant', schema);
