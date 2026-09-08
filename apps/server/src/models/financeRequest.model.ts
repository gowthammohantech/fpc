import { Schema, Types, model } from 'mongoose';
import {
  FINANCE_REQUEST_PRIORITIES,
  FINANCE_REQUEST_STATUSES,
  FinanceRequestStatus,
  type FinanceRequestAction,
  type FinanceRequestPriority,
} from '@fpc/shared';
import { baseSchemaOptions, orgScopedFields, scopedFields } from './base.js';

export interface FinanceRequestRemarkDoc {
  userId: Types.ObjectId;
  userName: string;
  at: Date;
  action?: string;
  text: string;
}

/**
 * A request from finance to the trustee team about one invoice.
 *
 * Deliberately not extra steps on the ApprovalRequest chain. An approval step
 * has no priority and no remarks, `ApprovalStepStatus` has no value for
 * "returned", and `approval.service.cancel` finds *the* open request for a
 * subject — a second chain on the same invoice would break that lookup.
 */
export interface FinanceRequestDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  groupId?: Types.ObjectId;
  regionId?: Types.ObjectId;
  verticalId?: Types.ObjectId;
  businessUnitId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  reference: string;
  invoiceId: Types.ObjectId;
  invoiceTrackingId: string;
  subjectLabel: string;
  vendorId?: Types.ObjectId;
  vendorName?: string;
  /** Snapshot in minor units, taken when accounting raised the request. */
  grossAmount: number;
  tdsAmount: number;
  netPayable: number;
  currency: 'INR';
  priority: FinanceRequestPriority;
  status: FinanceRequestStatus;
  requestedByUserId: Types.ObjectId;
  requestedByName: string;
  requestedAt: Date;
  remarks: FinanceRequestRemarkDoc[];
  decidedByUserId?: Types.ObjectId;
  decidedByName?: string;
  decidedAt?: Date;
  decision?: FinanceRequestAction;
}

const remarkSchema = new Schema<FinanceRequestRemarkDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    at: { type: Date, default: Date.now },
    action: String,
    text: { type: String, required: true },
  },
  { _id: false },
);

const schema = new Schema<FinanceRequestDoc>(
  {
    ...scopedFields(),
    ...orgScopedFields(),
    reference: { type: String, required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    invoiceTrackingId: { type: String, required: true },
    subjectLabel: { type: String, required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    vendorName: String,
    grossAmount: { type: Number, required: true },
    tdsAmount: { type: Number, default: 0 },
    netPayable: { type: Number, required: true },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    priority: { type: String, enum: FINANCE_REQUEST_PRIORITIES, required: true, index: true },
    status: {
      type: String,
      enum: FINANCE_REQUEST_STATUSES,
      default: FinanceRequestStatus.PENDING,
      index: true,
    },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, required: true },
    requestedAt: { type: Date, default: Date.now },
    remarks: { type: [remarkSchema], default: [] },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByName: String,
    decidedAt: Date,
    decision: String,
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, reference: 1 }, { unique: true });
// The trustee inbox: highest priority first, then oldest.
schema.index({ tenantId: 1, companyId: 1, status: 1, priority: 1, requestedAt: 1 });
// At most one open request per invoice, so "the escalation" is never ambiguous.
schema.index(
  { tenantId: 1, invoiceId: 1 },
  { unique: true, partialFilterExpression: { status: FinanceRequestStatus.PENDING } },
);

export const FinanceRequest = model<FinanceRequestDoc>('FinanceRequest', schema);
