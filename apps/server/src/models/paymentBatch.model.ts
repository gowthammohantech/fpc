import { Schema, Types, model } from 'mongoose';
import {
  PAYMENT_BATCH_STATUSES,
  PaymentBatchStatus,
  type BankFileFormat,
  type ObligationType,
  type ReconciliationStatus,
} from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface PaymentBatchDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  /** PB-YYYYMMDD-NNN */
  reference: string;
  paymentDate: Date;
  status: PaymentBatchStatus;
  bankAccountId?: Types.ObjectId;
  bankFileFormat: BankFileFormat;
  itemCount: number;
  /** All amounts in minor units. */
  totalAmount: number;
  vendorAmount: number;
  vendorCount: number;
  payrollAmount: number;
  payrollCount: number;
  currency: 'INR';
  reconciledAmount: number;
  reconciledCount: number;
  exportFileId?: Types.ObjectId;
  exportFileName?: string;
  exportedAt?: Date;
  exportedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  notes?: string;
}

const schema = new Schema<PaymentBatchDoc>(
  {
    ...scopedFields(),
    reference: { type: String, required: true },
    paymentDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: PAYMENT_BATCH_STATUSES,
      default: PaymentBatchStatus.DRAFT,
      index: true,
    },
    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    bankFileFormat: { type: String, default: 'GENERIC_XLSX' },
    itemCount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    vendorAmount: { type: Number, default: 0 },
    vendorCount: { type: Number, default: 0 },
    payrollAmount: { type: Number, default: 0 },
    payrollCount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    reconciledAmount: { type: Number, default: 0 },
    reconciledCount: { type: Number, default: 0 },
    exportFileId: { type: Schema.Types.ObjectId, ref: 'DocumentFile' },
    exportFileName: String,
    exportedAt: Date,
    exportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: String,
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, reference: 1 }, { unique: true });
schema.index({ tenantId: 1, companyId: 1, status: 1, paymentDate: -1 });

export const PaymentBatch = model<PaymentBatchDoc>('PaymentBatch', schema);

export interface PaymentBatchItemDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  paymentBatchId: Types.ObjectId;
  obligationId: Types.ObjectId;
  type: ObligationType;
  /** Beneficiary details copied at batch time — this is what the bank file said. */
  beneficiaryName: string;
  beneficiaryAccount: string;
  ifsc: string;
  amount: number;
  reference: string;
  reconciliationStatus: ReconciliationStatus;
}

const itemSchema = new Schema<PaymentBatchItemDoc>(
  {
    ...scopedFields(),
    paymentBatchId: {
      type: Schema.Types.ObjectId,
      ref: 'PaymentBatch',
      required: true,
      index: true,
    },
    obligationId: { type: Schema.Types.ObjectId, ref: 'PaymentObligation', required: true },
    type: { type: String, enum: ['VENDOR', 'PAYROLL'], required: true },
    beneficiaryName: { type: String, required: true },
    beneficiaryAccount: { type: String, required: true },
    ifsc: { type: String, required: true },
    amount: { type: Number, required: true },
    reference: { type: String, required: true },
    reconciliationStatus: { type: String, default: 'UNMATCHED' },
  },
  baseSchemaOptions,
);

itemSchema.index({ tenantId: 1, paymentBatchId: 1, obligationId: 1 }, { unique: true });

export const PaymentBatchItem = model<PaymentBatchItemDoc>('PaymentBatchItem', itemSchema);
