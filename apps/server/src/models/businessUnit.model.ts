import { Schema, Types, model } from 'mongoose';
import { BUSINESS_UNIT_KINDS, type BusinessUnitKind } from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface BusinessUnitDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  verticalId: Types.ObjectId;
  name: string;
  code: string;
  /**
   * A CLASSIFIED unit is invisible unless a user names it in their own scope,
   * so it cannot be reached by holding the vertical above it.
   */
  kind: BusinessUnitKind;
  active: boolean;
}

const schema = new Schema<BusinessUnitDoc>(
  {
    ...scopedFields(),
    verticalId: { type: Schema.Types.ObjectId, ref: 'Vertical', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    kind: { type: String, enum: BUSINESS_UNIT_KINDS, default: 'STANDARD', index: true },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, code: 1 }, { unique: true });

export const BusinessUnit = model<BusinessUnitDoc>('BusinessUnit', schema);
