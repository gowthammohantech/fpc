import { Schema, Types, model } from 'mongoose';
import { ROLE_KEYS, type ApprovalSubjectType, type RuleCondition, type RuleStepDefinition } from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

/**
 * An approval rule is data, not code (PRD §15).
 *
 * The PRD's ₹1L / ₹1L–₹10L / >₹10L ladder ships as seeded rows rather than
 * branching logic, so an administrator can change the thresholds or the
 * approver chain without a deployment.
 */
export interface ApprovalRuleDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  description?: string;
  appliesTo: ApprovalSubjectType;
  /** Higher wins when several rules match. */
  priority: number;
  active: boolean;
  conditions: RuleCondition[];
  steps: RuleStepDefinition[];
}

const conditionSchema = new Schema<RuleCondition>(
  {
    field: { type: String, required: true },
    operator: { type: String, required: true },
    value: Schema.Types.Mixed,
  },
  { _id: false },
);

const stepSchema = new Schema<RuleStepDefinition>(
  {
    order: { type: Number, required: true },
    approverType: { type: String, enum: ['ROLE', 'USER', 'DEPARTMENT_HEAD'], required: true },
    roleKey: { type: String, enum: ROLE_KEYS },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    label: String,
    slaHours: Number,
  },
  { _id: false },
);

const schema = new Schema<ApprovalRuleDoc>(
  {
    ...scopedFields(),
    name: { type: String, required: true, trim: true },
    description: String,
    appliesTo: { type: String, enum: ['VENDOR_INVOICE', 'PAYROLL_BATCH'], required: true, index: true },
    priority: { type: Number, default: 100 },
    active: { type: Boolean, default: true, index: true },
    conditions: { type: [conditionSchema], default: [] },
    steps: { type: [stepSchema], required: true },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, appliesTo: 1, active: 1, priority: -1 });

export const ApprovalRule = model<ApprovalRuleDoc>('ApprovalRule', schema);
