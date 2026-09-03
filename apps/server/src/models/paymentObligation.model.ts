import { Schema, Types, model } from 'mongoose';
import type {
  ApprovalStatus,
  ObligationType,
  PaymentStatus,
  ReconciliationStatus,
} from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

/**
 * A payment obligation — the platform's central financial concept (PRD §20).
 *
 * Vendor invoices and payroll both converge here, which is what lets one
 * payment queue, one batch format and one reconciliation engine serve both.
 *
 * The beneficiary details are a **snapshot** taken when the obligation is
 * created, not a reference to the vendor master. Editing a vendor's bank
 * account must never retroactively change where an already-approved payment
 * was going.
 */
export interface PaymentObligationDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  locationId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  type: ObligationType;
  /** Invoice id, or payroll employee row id. */
  sourceId: Types.ObjectId;
  /** Payroll obligations also carry their batch, for rollups. */
  sourceBatchId?: Types.ObjectId;
  reference: string;
  payeeName: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  ifsc: string;
  /** Minor units. */
  amount: number;
  currency: 'INR';
  dueDate?: Date;
  approvalStatus: ApprovalStatus;
  paymentStatus: PaymentStatus;
  reconciliationStatus: ReconciliationStatus;
  paymentBatchId?: Types.ObjectId;
  paymentBatchReference?: string;
  bankTransactionId?: Types.ObjectId;
  paidAt?: Date;
  reconciledAt?: Date;
  holdReason?: string;
}

const schema = new Schema<PaymentObligationDoc>(
  {
    ...scopedFields(),
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    type: { type: String, enum: ['VENDOR', 'PAYROLL'], required: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    sourceBatchId: { type: Schema.Types.ObjectId, index: true },
    reference: { type: String, required: true },
    payeeName: { type: String, required: true },
    beneficiaryName: { type: String, required: true },
    beneficiaryAccount: { type: String, required: true },
    ifsc: { type: String, required: true, uppercase: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },
    dueDate: { type: Date, index: true },
    approvalStatus: { type: String, default: 'APPROVED', index: true },
    paymentStatus: { type: String, default: 'QUEUED', index: true },
    reconciliationStatus: { type: String, default: 'UNMATCHED', index: true },
    paymentBatchId: { type: Schema.Types.ObjectId, ref: 'PaymentBatch', index: true },
    paymentBatchReference: String,
    bankTransactionId: { type: Schema.Types.ObjectId, ref: 'BankTransaction' },
    paidAt: Date,
    reconciledAt: Date,
    holdReason: String,
  },
  baseSchemaOptions,
);

// One obligation per source record: re-running approval must never create a
// second instruction to pay the same invoice or employee.
schema.index({ tenantId: 1, type: 1, sourceId: 1 }, { unique: true });
// Drives the payment queue.
schema.index({ tenantId: 1, companyId: 1, paymentStatus: 1, dueDate: 1 });
// Drives reconciliation candidate lookup.
schema.index({ tenantId: 1, companyId: 1, reconciliationStatus: 1, amount: 1 });

export const PaymentObligation = model<PaymentObligationDoc>('PaymentObligation', schema);
