import { Schema, Types, model } from 'mongoose';
import { ROLE_KEYS, type ApprovalStatus, type ApprovalStepStatus, type ApprovalSubjectType, type ApproverType, type RoleKey } from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface ApprovalStepDoc {
  order: number;
  label: string;
  approverType: ApproverType;
  roleKey?: RoleKey;
  /** Users eligible to act on this step; any one of them may decide. */
  candidateUserIds: Types.ObjectId[];
  status: ApprovalStepStatus;
  actedByUserId?: Types.ObjectId;
  actedByName?: string;
  actedAt?: Date;
  comment?: string;
  slaHours?: number;
  dueAt?: Date;
}

export interface ApprovalRequestDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  subjectType: ApprovalSubjectType;
  subjectId: Types.ObjectId;
  subjectLabel: string;
  /** Minor units. */
  amount: number;
  currency: 'INR';
  ruleId?: Types.ObjectId;
  ruleName?: string;
  status: ApprovalStatus;
  currentStepOrder: number;
  steps: ApprovalStepDoc[];
  requestedByUserId: Types.ObjectId;
  requestedAt: Date;
  completedAt?: Date;
}

const stepSchema = new Schema<ApprovalStepDoc>(
  {
    order: { type: Number, required: true },
    label: { type: String, required: true },
    approverType: { type: String, required: true },
    roleKey: { type: String, enum: ROLE_KEYS },
    candidateUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'SKIPPED'],
      default: 'PENDING',
    },
    actedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    actedByName: String,
    actedAt: Date,
    comment: String,
    slaHours: Number,
    dueAt: Date,
  },
  { _id: false },
);

const schema = new Schema<ApprovalRequestDoc>(
  {
    ...scopedFields(),
    subjectType: { type: String, enum: ['VENDOR_INVOICE', 'PAYROLL_BATCH'], required: true, index: true },
    subjectId: { type: Schema.Types.ObjectId, required: true, index: true },
    subjectLabel: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    ruleId: { type: Schema.Types.ObjectId, ref: 'ApprovalRule' },
    ruleName: String,
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'NOT_REQUIRED'],
      default: 'PENDING',
      index: true,
    },
    currentStepOrder: { type: Number, default: 1 },
    steps: { type: [stepSchema], default: [] },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  baseSchemaOptions,
);

// "What is waiting on me" is the single most common approvals query.
schema.index({ tenantId: 1, status: 1, 'steps.status': 1, 'steps.candidateUserIds': 1 });
schema.index({ tenantId: 1, companyId: 1, subjectType: 1, status: 1, requestedAt: -1 });

export const ApprovalRequest = model<ApprovalRequestDoc>('ApprovalRequest', schema);
