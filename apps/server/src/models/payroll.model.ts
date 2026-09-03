import { Schema, Types, model } from 'mongoose';
import {
  PAYROLL_BATCH_STATUSES,
  PayrollBatchStatus,
  type ApprovalStatus,
  type ValidationFinding,
} from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface PayrollBatchDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  reference: string;
  periodMonth: number;
  periodYear: number;
  label: string;
  status: PayrollBatchStatus;
  employeeCount: number;
  /** Minor units. */
  totalNetAmount: number;
  currency: 'INR';
  locationBreakdown: Array<{
    locationId?: Types.ObjectId;
    locationName: string;
    count: number;
    amount: number;
  }>;
  /** Previous period, for the month-on-month delta the CFO reviews (PRD §19). */
  previousBatchId?: Types.ObjectId;
  previousTotalNetAmount?: number;
  sourceFileId?: Types.ObjectId;
  sourceFileName?: string;
  findings: ValidationFinding[];
  approvalRequestId?: Types.ObjectId;
  approvalStatus: ApprovalStatus;
  paymentBatchId?: Types.ObjectId;
  importedBy?: Types.ObjectId;
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;
  paidAt?: Date;
}

const findingSchema = new Schema<ValidationFinding>(
  {
    code: { type: String, required: true },
    severity: { type: String, required: true },
    message: { type: String, required: true },
    field: String,
    relatedEntityIds: [String],
    resolved: { type: Boolean, default: false },
    resolvedBy: String,
    resolvedAt: String,
    resolutionNote: String,
  },
  { _id: false },
);

const batchSchema = new Schema<PayrollBatchDoc>(
  {
    ...scopedFields(),
    reference: { type: String, required: true },
    periodMonth: { type: Number, required: true, min: 1, max: 12 },
    periodYear: { type: Number, required: true },
    label: { type: String, required: true },
    status: {
      type: String,
      enum: PAYROLL_BATCH_STATUSES,
      default: PayrollBatchStatus.DRAFT,
      index: true,
    },
    employeeCount: { type: Number, default: 0 },
    totalNetAmount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    locationBreakdown: {
      type: [
        {
          _id: false,
          locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
          locationName: String,
          count: Number,
          amount: Number,
        },
      ],
      default: [],
    },
    previousBatchId: { type: Schema.Types.ObjectId, ref: 'PayrollBatch' },
    previousTotalNetAmount: Number,
    sourceFileId: { type: Schema.Types.ObjectId, ref: 'DocumentFile' },
    sourceFileName: String,
    findings: { type: [findingSchema], default: [] },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    approvalStatus: { type: String, default: 'NOT_REQUIRED' },
    paymentBatchId: { type: Schema.Types.ObjectId, ref: 'PaymentBatch' },
    importedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    paidAt: Date,
  },
  baseSchemaOptions,
);

// One payroll run per company per period.
batchSchema.index({ tenantId: 1, companyId: 1, periodYear: 1, periodMonth: 1 }, { unique: true });

export const PayrollBatch = model<PayrollBatchDoc>('PayrollBatch', batchSchema);

export interface PayrollEmployeeDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  payrollBatchId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  bankAccountNumber: string;
  ifsc: string;
  /** Minor units. */
  netAmount: number;
  departmentName?: string;
  departmentId?: Types.ObjectId;
  locationName?: string;
  locationId?: Types.ObjectId;
  email?: string;
  obligationId?: Types.ObjectId;
  /** Row in the uploaded sheet, so import errors point at the right line. */
  rowNumber: number;
  findings: ValidationFinding[];
}

const employeeSchema = new Schema<PayrollEmployeeDoc>(
  {
    ...scopedFields(),
    payrollBatchId: {
      type: Schema.Types.ObjectId,
      ref: 'PayrollBatch',
      required: true,
      index: true,
    },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    bankAccountNumber: { type: String, required: true },
    ifsc: { type: String, required: true, uppercase: true },
    netAmount: { type: Number, required: true },
    departmentName: String,
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    locationName: String,
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', index: true },
    email: String,
    obligationId: { type: Schema.Types.ObjectId, ref: 'PaymentObligation' },
    rowNumber: { type: Number, required: true },
    findings: { type: [findingSchema], default: [] },
  },
  baseSchemaOptions,
);

// The same employee must not appear twice in one payroll run.
employeeSchema.index({ payrollBatchId: 1, employeeCode: 1 }, { unique: true });

export const PayrollEmployee = model<PayrollEmployeeDoc>('PayrollEmployee', employeeSchema);
