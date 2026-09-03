import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface BankAccountDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  label: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  /** Minor units. Refreshed from the closing balance of imported statements. */
  currentBalance: number;
  balanceAsOf?: Date;
  bankFileFormat: 'HDFC' | 'ICICI' | 'GENERIC_CSV' | 'GENERIC_XLSX';
  active: boolean;
}

const schema = new Schema<BankAccountDoc>(
  {
    ...scopedFields(),
    label: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, trim: true, uppercase: true },
    currentBalance: { type: Number, default: 0 },
    balanceAsOf: Date,
    bankFileFormat: {
      type: String,
      enum: ['HDFC', 'ICICI', 'GENERIC_CSV', 'GENERIC_XLSX'],
      default: 'GENERIC_XLSX',
    },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, accountNumber: 1 }, { unique: true });

export const BankAccount = model<BankAccountDoc>('BankAccount', schema);
