import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface DepartmentDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  code: string;
  /** Resolved by DEPARTMENT_HEAD approval steps (PRD §15). */
  headUserId?: Types.ObjectId;
  active: boolean;
}

const schema = new Schema<DepartmentDoc>(
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

export const Department = model<DepartmentDoc>('Department', schema);
