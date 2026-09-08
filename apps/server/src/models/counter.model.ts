import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions } from './base.js';

/**
 * Monotonic sequence per tenant, one document per counter key.
 *
 * The alternative already in the codebase — scanning existing rows for the
 * highest reference and adding one — is fine for a handful of payment batches
 * a day but cannot number every invoice, so this replaces it.
 */
export interface CounterDoc {
  tenantId: Types.ObjectId;
  /** e.g. `invoice:2026`, `finance_request:2026`. */
  key: string;
  value: number;
}

const schema = new Schema<CounterDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    key: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const Counter = model<CounterDoc>('Counter', schema);
