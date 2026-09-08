import { Schema, Types, model } from 'mongoose';
import { TDS_SECTIONS, normalizeName, type TdsSection } from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

/** Lightweight vendor master — PRD §10. No KYC workflow by design. */
export interface VendorDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  code: string;
  name: string;
  /** Normalised name, used to resolve extracted vendor names to this record. */
  nameNormalized: string;
  email?: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  /**
   * Whether TDS is withheld from this vendor's invoices by default. Only a
   * default: the accounting team decides per invoice and can override it.
   */
  tdsApplicable: boolean;
  tdsSection?: TdsSection;
  /** Integer basis points — 10% is 1000. Never a float; see `money.ts`. */
  tdsRateBasisPoints?: number;
  bankAccountNumber?: string;
  ifsc?: string;
  beneficiaryName?: string;
  paymentTermsDays: number;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  notes?: string;
}

const schema = new Schema<VendorDoc>(
  {
    ...scopedFields(),
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    nameNormalized: { type: String, required: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    pan: { type: String, trim: true, uppercase: true },
    tdsApplicable: { type: Boolean, default: false },
    tdsSection: { type: String, enum: [...TDS_SECTIONS, null] },
    tdsRateBasisPoints: { type: Number, min: 0, max: 10_000 },
    bankAccountNumber: { type: String, trim: true },
    ifsc: { type: String, trim: true, uppercase: true },
    beneficiaryName: { type: String, trim: true },
    paymentTermsDays: { type: Number, default: 30, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    notes: { type: String, trim: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, code: 1 }, { unique: true });
schema.index({ tenantId: 1, companyId: 1, nameNormalized: 1 });

schema.pre('validate', function normalize(next) {
  if (this.isModified('name') || !this.nameNormalized) {
    this.nameNormalized = normalizeName(this.name);
  }
  next();
});

export const Vendor = model<VendorDoc>('Vendor', schema);
