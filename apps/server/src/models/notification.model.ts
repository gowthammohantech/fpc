import { Schema, Types, model } from 'mongoose';
import type { EntityType, NotificationType } from '@fpc/shared';
import { baseSchemaOptions } from './base.js';

export interface NotificationDoc {
  tenantId: Types.ObjectId;
  companyId?: Types.ObjectId;
  userId?: Types.ObjectId;
  toEmail?: string;
  type: NotificationType;
  channel: 'IN_APP' | 'EMAIL';
  status: 'PENDING' | 'SENT' | 'READ' | 'FAILED';
  title: string;
  body: string;
  link?: string;
  entityType?: EntityType;
  entityId?: Types.ObjectId;
  sentAt?: Date;
  readAt?: Date;
  attempts: number;
  error?: string;
}

const schema = new Schema<NotificationDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    toEmail: String,
    type: { type: String, required: true },
    channel: { type: String, enum: ['IN_APP', 'EMAIL'], required: true },
    status: {
      type: String,
      enum: ['PENDING', 'SENT', 'READ', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: String,
    entityType: String,
    entityId: Schema.Types.ObjectId,
    sentAt: Date,
    readAt: Date,
    attempts: { type: Number, default: 0 },
    error: String,
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, userId: 1, status: 1, createdAt: -1 });
schema.index({ channel: 1, status: 1, attempts: 1 });

export const Notification = model<NotificationDoc>('Notification', schema);
