import { Schema, Types, model } from 'mongoose';
import {
  MAIL_ATTACHMENT_STATUSES,
  MAIL_INGESTION_STATUSES,
  MAIL_PROVIDERS,
  MAIL_SKIP_REASONS,
  MailIngestionStatus,
  type MailAttachmentStatus,
  type MailIngestionStatus as MailIngestionStatusType,
  type MailProvider,
  type MailSkipReason,
} from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

/**
 * One email pulled from a connected mailbox, and what became of its
 * attachments.
 *
 * This is the record the Invoice Mailbox screen reads, and it deliberately
 * keeps the messages that produced nothing. An `Invoice` records a document
 * that made it through; this records everything the mailbox offered, including
 * the ones we skipped and why — which is the only way to answer "so where is
 * my invoice?" without reading a server log.
 *
 * Invoice status is *not* copied in here. The list route joins the live
 * `Invoice` rows after paginating, so the screen stays truthful once a human
 * approves or pays one, with nothing to keep in step.
 */

export interface MailIngestionAttachmentDoc {
  name: string;
  contentType: string;
  size: number;
  /** Provider attachment id, so a retry need not re-list the message. */
  attachmentId?: string;
  status: MailAttachmentStatus;
  skipReason?: string;
  /** The exact `Invoice.emailMessageId` this was ingested under. */
  messageKey?: string;
  invoiceId?: Types.ObjectId;
  error?: string;
  extractionStartedAt?: Date;
  extractionCompletedAt?: Date;
}

export interface MailIngestionDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  connectionId: Types.ObjectId;
  /** Denormalised: the oversight view shows whose mailbox a row came from. */
  userId: Types.ObjectId;
  provider: MailProvider;
  providerMessageId: string;
  /** RFC 5322 Message-ID — identical across every copy of the same email. */
  internetMessageId?: string;
  conversationId?: string;
  subject: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: string[];
  receivedAt: Date;
  bodyPreview?: string;
  folderName?: string;
  /** Powers "Open in Outlook". */
  webLink?: string;
  status: MailIngestionStatusType;
  skipReason?: MailSkipReason;
  error?: string;
  attachmentCount: number;
  processedCount: number;
  attachments: MailIngestionAttachmentDoc[];
  /** Groups everything one "Sync now" produced. */
  syncRunId: string;
  startedAt: Date;
  completedAt?: Date;
}

const attachmentSchema = new Schema<MailIngestionAttachmentDoc>(
  {
    name: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, default: 0 },
    attachmentId: { type: String },
    status: { type: String, enum: MAIL_ATTACHMENT_STATUSES, required: true },
    skipReason: { type: String },
    messageKey: { type: String },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    error: { type: String },
    extractionStartedAt: { type: Date },
    extractionCompletedAt: { type: Date },
  },
  { _id: false },
);

const schema = new Schema<MailIngestionDoc>(
  {
    ...scopedFields(),
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: 'MailConnection',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: MAIL_PROVIDERS, required: true },
    providerMessageId: { type: String, required: true },
    internetMessageId: { type: String },
    conversationId: { type: String },
    subject: { type: String, required: true },
    fromAddress: { type: String, required: true, lowercase: true, trim: true },
    fromName: { type: String },
    toAddresses: { type: [String], default: [] },
    receivedAt: { type: Date, required: true, index: true },
    bodyPreview: { type: String },
    folderName: { type: String },
    webLink: { type: String },
    status: {
      type: String,
      enum: MAIL_INGESTION_STATUSES,
      default: MailIngestionStatus.PENDING,
      index: true,
    },
    skipReason: { type: String, enum: MAIL_SKIP_REASONS },
    error: { type: String },
    attachmentCount: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    attachments: { type: [attachmentSchema], default: [] },
    syncRunId: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
  },
  baseSchemaOptions,
);

/**
 * The idempotency index. Re-syncing a mailbox re-reads messages by design (the
 * watermark overlaps deliberately), so a second sighting must update this row
 * rather than add another.
 */
schema.index({ tenantId: 1, connectionId: 1, providerMessageId: 1 }, { unique: true });

/** Default sort for the screen. */
schema.index({ tenantId: 1, companyId: 1, receivedAt: -1 });

/** The tab filters. */
schema.index({ tenantId: 1, connectionId: 1, status: 1, receivedAt: -1 });

/** Jump from an invoice back to the email that carried it. */
schema.index({ 'attachments.invoiceId': 1 }, { sparse: true });

export const MailIngestion = model<MailIngestionDoc>('MailIngestion', schema);
