import { Schema, Types, model } from 'mongoose';
import type { EntityType } from '@fpc/shared';

export interface AuditEventDoc {
  tenantId: Types.ObjectId;
  companyId?: Types.ObjectId;
  event: string;
  entityType: EntityType;
  entityId: Types.ObjectId;
  entityLabel?: string;
  userId?: Types.ObjectId;
  userName?: string;
  timestamp: Date;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string;
  requestId?: string;
}

const schema = new Schema<AuditEventDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    event: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    entityLabel: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userName: String,
    timestamp: { type: Date, default: Date.now, index: true },
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    metadata: Schema.Types.Mixed,
    ip: String,
    requestId: String,
  },
  {
    timestamps: false,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

schema.index({ tenantId: 1, entityType: 1, entityId: 1, timestamp: -1 });
schema.index({ tenantId: 1, timestamp: -1 });

/**
 * Audit records must not be editable (PRD §29).
 *
 * No route exposes mutation, and these guards make it a schema-level
 * guarantee so a future service cannot quietly rewrite history either.
 */
const IMMUTABLE = 'Audit events are append-only and cannot be modified or deleted';
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  schema.pre(op as 'updateOne', function guard() {
    throw new Error(IMMUTABLE);
  });
}
schema.pre('save', function guard(next) {
  if (!this.isNew) {
    next(new Error(IMMUTABLE));
    return;
  }
  next();
});

export const AuditEvent = model<AuditEventDoc>('AuditEvent', schema);
