import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions } from './base.js';

export interface CompanyDoc {
  tenantId: Types.ObjectId;
  name: string;
  legalName?: string;
  gstin?: string;
  cin?: string;
  /** Mailbox monitored for inbound vendor invoices (PRD §11). */
  invoiceInboxAddress?: string;
  baseCurrency: 'INR';
  active: boolean;
}

const schema = new Schema<CompanyDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    cin: { type: String, trim: true, uppercase: true },
    invoiceInboxAddress: { type: String, trim: true, lowercase: true },
    baseCurrency: { type: String, enum: ['INR'], default: 'INR' },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, name: 1 }, { unique: true });
schema.index({ invoiceInboxAddress: 1 }, { sparse: true });

export const Company = model<CompanyDoc>('Company', schema);
